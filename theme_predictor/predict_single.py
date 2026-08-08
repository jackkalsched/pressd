"""
Predict theme, replay, distinctness, and album score for a single album.
Called as a background task when a new to_listen album is added.
"""

import json
import math
import sys
import pathlib
from sqlalchemy import text

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from backend.database import engine


# ── Audio analysis helper ─────────────────────────────────────────────────────

_AF_COLS = (
    "bpm", "bpm_confidence", "key", "scale", "key_strength",
    "chords_changes_rate", "loudness_db", "dynamic_complexity",
    "danceability", "energy", "dissonance", "spectral_centroid",
    "inharmonicity", "onset_rate", "loudness_lufs", "mfcc",
)


def _analyze_and_store_songs(con, album_id: int, artist: str, album_name: str) -> bool:
    """Download audio for each song via yt-dlp, extract Essentia features, persist to
    songaudiofeatures. Skips songs that already have bpm set. Returns True if at least
    one song was successfully analyzed."""
    import tempfile, subprocess, os, glob, re
    from datetime import datetime

    songs = con.execute(
        text("SELECT id, title, track_number FROM song WHERE album_id = :id ORDER BY track_number"),
        {"id": album_id},
    ).fetchall()
    if not songs:
        return False

    # Determine which songs already have audio features
    song_ids = [s[0] for s in songs]
    placeholders = ", ".join(str(i) for i in song_ids)
    existing = set(
        r[0] for r in con.execute(
            text(f"SELECT song_id FROM songaudiofeatures WHERE song_id IN ({placeholders}) AND bpm IS NOT NULL")
        ).fetchall()
    )
    to_analyze = [(sid, title, tn) for sid, title, tn in songs if sid not in existing]
    if not to_analyze:
        print(f"[predict_single] audio features already present for all songs in album {album_id}")
        return True

    try:
        from backend.routers.audio import _analyze_file
    except Exception as e:
        print(f"[predict_single] essentia unavailable: {e}")
        return False

    success = 0
    with tempfile.TemporaryDirectory() as tmpdir:
        for song_id, title, track_number in to_analyze:
            search = f"ytsearch1:{title} {artist} {album_name}"
            out_tmpl = os.path.join(tmpdir, f"{(track_number or 0):03d}_%(title)s.%(ext)s")
            try:
                subprocess.run(
                    ["yt-dlp", "--default-search", "ytsearch", "--no-playlist",
                     "-x", "--audio-format", "mp3", "--audio-quality", "0",
                     "-o", out_tmpl, search],
                    capture_output=True, text=True, timeout=90,
                )
            except Exception:
                continue

        file_by_track: dict[int, str] = {}
        for f in sorted(glob.glob(os.path.join(tmpdir, "*.mp3"))):
            m = re.match(r'^(\d+)_', os.path.basename(f))
            if m:
                file_by_track[int(m.group(1))] = f

        for song_id, title, track_number in to_analyze:
            audio_path = file_by_track.get(track_number or 0)
            if not audio_path:
                print(f"[predict_single] no audio downloaded for: {title}")
                continue
            try:
                features = _analyze_file(audio_path)
                now = datetime.utcnow().isoformat()

                existing_row = con.execute(
                    text("SELECT id FROM songaudiofeatures WHERE song_id = :sid"),
                    {"sid": song_id},
                ).fetchone()

                params = {"song_id": song_id, "title": title, "analyzed_at": now,
                          **{c: features.get(c) for c in _AF_COLS}}

                if existing_row:
                    sets = ", ".join(f"{c} = :{c}" for c in (*_AF_COLS, "title", "analyzed_at"))
                    con.execute(
                        text(f"UPDATE songaudiofeatures SET {sets} WHERE song_id = :song_id"),
                        params,
                    )
                else:
                    col_list = "song_id, title, analyzed_at, " + ", ".join(_AF_COLS)
                    val_list = ":song_id, :title, :analyzed_at, " + ", ".join(f":{c}" for c in _AF_COLS)
                    con.execute(
                        text(f"INSERT INTO songaudiofeatures ({col_list}) VALUES ({val_list})"),
                        params,
                    )
                con.commit()
                success += 1
                print(f"[predict_single] analyzed: {title}")
            except Exception as e:
                print(f"[predict_single] audio failed for {title}: {e}")

    return success > 0



def predict_album(album_id: int):
    """Full prediction pipeline for one album. Safe to call from a background thread."""
    try:
        _run(album_id)
    except Exception as e:
        print(f"[predict_single] album {album_id} failed: {e}")


def _run(album_id: int):
    with engine.connect() as con:
        row = con.execute(
            text("SELECT artist, album_name, year, genre, user_id FROM album WHERE id = :id"),
            {"id": album_id},
        ).fetchone()
        if not row:
            return
        artist, album_name, year, genre, user_id = row
        print(f"[predict_single] Starting predictions for {artist} – {album_name} (id={album_id})")

        # ── 1. Audio features + song score prediction (run first so song mean is available) ──
        predicted_song_mean = None
        try:
            _analyze_and_store_songs(con, album_id, artist, album_name)
            # Bridge until worker cutover: link new songs to global tracks and
            # copy fresh songaudiofeatures rows into trackaudio (the model's
            # only audio source)
            from worker.migrate_tracks import sync_tracks
            sync_tracks(con)
            from song_score_model import predict_for_album
            predicted_song_mean = predict_for_album(con, album_id)
            if predicted_song_mean is not None:
                print(f"[predict_single] predicted_song_mean={round(predicted_song_mean, 3)}")
                con.execute(
                    text("UPDATE album SET predicted_song_mean = :mean WHERE id = :id"),
                    {"mean": round(predicted_song_mean, 4), "id": album_id},
                )
                con.commit()
        except Exception as e:
            print(f"[predict_single] song model failed: {e}")

        # ── 3+4. Theme + distinctness (Claude + user's own ratings as RAG) ──────
        predict_llm_factors(con, album_id, artist, album_name, year, genre, user_id)

        # ── 5. Replay ─────────────────────────────────────────────────────────────
        try:
            from generate_genres_lastfm import infer_genres

            artist_row = con.execute(
                text("SELECT AVG(replay_value) FROM album WHERE status='rated' AND replay_value IS NOT NULL AND artist = :artist AND user_id = :uid"),
                {"artist": artist, "uid": user_id},
            ).fetchone()
            artist_replay = artist_row[0] if artist_row and artist_row[0] else None

            if artist_replay is None:
                try:
                    from theme_predictor.corpus import LASTFM_KEY
                    import pylast
                    network = pylast.LastFMNetwork(api_key=LASTFM_KEY)
                    tags = [t.item.name for t in network.get_artist(artist).get_top_tags(limit=10)]
                    inferred_genre, _ = infer_genres(tags)
                    genre_row = con.execute(
                        text("SELECT AVG(replay_value) FROM album WHERE status='rated' AND replay_value IS NOT NULL AND genre = :genre AND user_id = :uid"),
                        {"genre": inferred_genre, "uid": user_id},
                    ).fetchone()
                    artist_replay = genre_row[0] if genre_row and genre_row[0] else None
                except Exception:
                    pass

            if artist_replay is None:
                artist_replay = con.execute(
                    text("SELECT AVG(replay_value) FROM album WHERE status='rated' AND replay_value IS NOT NULL AND user_id = :uid"),
                    {"uid": user_id},
                ).fetchone()[0]

            pred_replay = round(max(1.0, min(10.0, artist_replay)), 1)
            con.execute(
                text("UPDATE album SET predicted_replay = :replay WHERE id = :id"),
                {"replay": pred_replay, "id": album_id},
            )
            con.commit()
            print(f"[predict_single] replay={pred_replay}")
        except Exception as e:
            print(f"[predict_single] replay failed: {e}")

        # ── 6. Predicted album score ──────────────────────────────────────────────
        try:
            pred = con.execute(
                text("SELECT predicted_theme, predicted_replay, predicted_distinctness FROM album WHERE id = :id"),
                {"id": album_id},
            ).fetchone()
            if pred and all(v is not None for v in pred):
                pred_theme, pred_replay, pred_dist = pred
                theme_mu, theme_sd   = _factor_stats(con, "theme", user_id)
                replay_mu, replay_sd = _factor_stats(con, "replay_value", user_id)
                dist_mu, dist_sd     = _factor_stats(con, "distinctness", user_id)

                # Use song model prediction if available, otherwise fall back to user's own mean
                if predicted_song_mean is not None:
                    song_component = predicted_song_mean
                else:
                    song_component = con.execute(
                        text("SELECT AVG(s.score) FROM song s JOIN album a ON a.id=s.album_id"
                             " WHERE a.status='rated' AND a.user_id = :uid AND s.score IS NOT NULL"),
                        {"uid": user_id},
                    ).fetchone()[0] or 7.21
                    print(f"[predict_single] falling back to user song_mean={round(song_component, 3)}")

                z_theme  = (pred_theme  - theme_mu)  / theme_sd
                z_replay = (pred_replay - replay_mu) / replay_sd
                z_dist   = (pred_dist   - dist_mu)   / dist_sd
                # Small-sample factor sds can inflate z-terms; no album may
                # ever show a predicted score above 10/10
                pred_score = min(round(1.0 * song_component + 0.25 * z_theme + 0.15 * z_replay + 0.05 * z_dist, 2), 10.0)
                con.execute(
                    text("UPDATE album SET predicted_score = :score WHERE id = :id"),
                    {"score": pred_score, "id": album_id},
                )
                con.commit()
                print(f"[predict_single] predicted_score={pred_score}")
        except Exception as e:
            print(f"[predict_single] score failed: {e}")

        # Re-normalize all predicted themes now that there's a new data point
        try:
            normalize_predicted_themes()
        except Exception as e:
            print(f"[predict_single] theme normalization failed: {e}")

        print(f"[predict_single] Done: {artist} – {album_name}")


def _rag_corpus(artist: str, album_name: str, genre: str | None) -> dict:
    """Corpus for a RAG example album: shared DB store → local file → stub."""
    from .corpus import _db_corpus_read, CACHE_DIR, _safe_filename
    data = _db_corpus_read(artist, album_name)
    if data is not None:
        return data
    path = CACHE_DIR / f"{_safe_filename(artist, album_name)}.json"
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    return {"llm_analysis": "", "genre": genre}


def predict_llm_factors(con, album_id: int, artist: str, album_name: str,
                        year: int | None, genre: str | None, user_id: int):
    """Theme + distinctness for one album, on the owner's scale.

    Scores the album globally if nobody has yet (one LLM pass per album, ever),
    then derives this user's values from it — Layer 1 rescaling plus, past the
    gate, their learned Layer 2 corrections. See theme_predictor.personalize.

    Falls back to the original per-copy LLM call only if the album has no
    global row and couldn't get one, so a cold DB still produces something.
    """
    from .global_factors import ensure_global_factors
    from .personalize import build_user_models

    try:
        factors = ensure_global_factors(con, artist, album_name, year, genre, album_id)
    except Exception as e:
        print(f"[predict_single] global factors failed: {e}")
        factors = None

    if factors and (factors["theme_raw"] is not None
                    or factors["distinctness_raw"] is not None):
        models = build_user_models(con, user_id)
        theme = models["theme"].predict(factors["theme_raw"], genre, year)
        dist = models["distinctness"].predict(factors["distinctness_raw"], genre, year)
        con.execute(text(
            "UPDATE album SET predicted_theme = COALESCE(:t, predicted_theme),"
            " predicted_theme_reasoning = COALESCE(:tr, predicted_theme_reasoning),"
            " predicted_distinctness = COALESCE(:d, predicted_distinctness)"
            " WHERE id = :id"),
            {"t": theme, "tr": factors["theme_reasoning"], "d": dist, "id": album_id})
        con.commit()
        print(f"[predict_single] theme={theme} distinctness={dist} "
              f"(global raw {factors['theme_raw']}/{factors['distinctness_raw']}, "
              f"L{models['theme'].layer})")
        return

    print("[predict_single] no global factors — falling back to per-copy LLM call")
    _predict_llm_factors_per_copy(con, album_id, artist, album_name, year, genre, user_id)


def _predict_llm_factors_per_copy(con, album_id: int, artist: str, album_name: str,
                                  year: int | None, genre: str | None, user_id: int):
    """Original per-user-copy LLM call. Retained only as the cold-start
    fallback for an album the global pass couldn't score; its output still
    needs normalize_predicted_themes afterwards, which the global path does
    not."""
    # ── Theme ──
    try:
        from .corpus import load_or_build_corpus
        from .predictor import predict_theme

        corpus = load_or_build_corpus(album_id, artist, album_name, year, None)
        corpus["genre"] = genre

        theme_rows = con.execute(text("""
            SELECT id, artist, album_name, genre, theme FROM album
            WHERE status='rated' AND theme IS NOT NULL AND user_id = :uid
            ORDER BY CASE WHEN genre = :g THEN 0 ELSE 1 END, theme DESC
            LIMIT 5
        """), {"g": genre or "", "uid": user_id}).fetchall()

        example_dicts = [
            {"album_id": r[0], "artist": r[1], "album_name": r[2], "theme_score": r[4]}
            for r in theme_rows
        ]
        corpora_map = {r[0]: _rag_corpus(r[1], r[2], r[3]) for r in theme_rows}

        score, reasoning = predict_theme(corpus, example_dicts, corpora_map)
        if score is not None:
            norm_score = round(max(1.0, min(10.0, float(score))))
            con.execute(
                text("UPDATE album SET predicted_theme = :theme, predicted_theme_reasoning = :reasoning WHERE id = :id"),
                {"theme": norm_score, "reasoning": reasoning, "id": album_id},
            )
            con.commit()
            print(f"[predict_single] theme={norm_score}")
    except Exception as e:
        print(f"[predict_single] theme failed: {e}")

    # ── Distinctness ──
    try:
        from .corpus import load_or_build_corpus
        from .distinctness_predictor import predict_distinctness

        corpus = load_or_build_corpus(album_id, artist, album_name, year, None)
        corpus["genre"] = genre

        dist_rows = con.execute(text("""
            SELECT id, artist, album_name, genre, distinctness FROM album
            WHERE status='rated' AND distinctness IS NOT NULL AND user_id = :uid
            ORDER BY CASE WHEN genre = :g THEN 0 ELSE 1 END, distinctness DESC
            LIMIT 5
        """), {"g": genre or "", "uid": user_id}).fetchall()

        d_examples = [
            {"album_id": r[0], "artist": r[1], "album_name": r[2], "theme_score": r[4]}
            for r in dist_rows
        ]
        d_corpora = {r[0]: _rag_corpus(r[1], r[2], r[3]) for r in dist_rows}

        d_score, _ = predict_distinctness(corpus, d_examples, d_corpora)
        if d_score is not None:
            norm = round(max(1.0, min(10.0, d_score)), 0)
            con.execute(
                text("UPDATE album SET predicted_distinctness = :dist WHERE id = :id"),
                {"dist": norm, "id": album_id},
            )
            con.commit()
            print(f"[predict_single] distinctness={norm}")
    except Exception as e:
        print(f"[predict_single] distinctness failed: {e}")


def normalize_predicted_themes(only_user: int | None = None):
    """Remap predicted_theme values so their distribution matches the user's actual
    theme rating distribution. Prevents LLM scores from being systematically biased.

    Only touches albums scored by the legacy per-copy call. A value derived from
    `albumfactors` has already been put on the user's scale by Layer 1
    (theme_predictor.personalize), and re-normalising it here would remap an
    already-remapped number — compounding drift on every run.
    """
    from backend.trackkeys import album_key

    with engine.connect() as con:
        globally_scored = {
            r[0] for r in con.execute(text(
                "SELECT album_key FROM albumfactors WHERE theme_raw IS NOT NULL")).fetchall()
        }
        user_ids = [r[0] for r in con.execute(
            text("SELECT DISTINCT user_id FROM album WHERE status IN ('to_listen', 'listening') AND predicted_theme IS NOT NULL")
        ).fetchall()]
        if only_user is not None:
            user_ids = [u for u in user_ids if u == only_user]
        for user_id in user_ids:
            target_mu, target_sd = _factor_stats(con, "theme", user_id)
            rows = con.execute(
                text("SELECT id, predicted_theme, artist, album_name FROM album"
                     " WHERE user_id=:uid AND status IN ('to_listen', 'listening')"
                     " AND predicted_theme IS NOT NULL"),
                {"uid": user_id},
            ).fetchall()
            rows = [(rid, pt) for rid, pt, artist, name in rows
                    if album_key(artist, name) not in globally_scored]
            if not rows:
                continue
            raw_scores = [r[1] for r in rows]
            mu = sum(raw_scores) / len(raw_scores)
            sd = math.sqrt(sum((x - mu) ** 2 for x in raw_scores) / len(raw_scores)) or 1.0
            updated = 0
            for album_id, raw in rows:
                z = (raw - mu) / sd
                norm = round(max(1.0, min(10.0, z * target_sd + target_mu)))
                con.execute(
                    text("UPDATE album SET predicted_theme = :t WHERE id = :id"),
                    {"t": norm, "id": album_id},
                )
                updated += 1
            con.commit()
            print(f"[normalize_themes] user {user_id}: normalized {updated} albums "
                  f"(raw mu={round(mu,2)}, sd={round(sd,2)}) → target mu={round(target_mu,2)}, sd={round(target_sd,2)}")


def recompute_all_predictions():
    """Recompute predicted_replay and predicted_score for all unrated albums.
    Called after a new album is rated so factor stats stay current. No LLM calls."""
    with engine.connect() as con:
        _recompute_unrated(con)


def _recompute_unrated(con, only_user: int | None = None,
                       use_stored_replay: bool = False):
    """Recompute predicted_replay + composite predicted_score per user.

    use_stored_replay=True (nightly worker): predicted_replay was already
    written by the cluster-based replay stage — consume it instead of
    recomputing the artist/genre-average heuristic, which would clobber it.
    Heuristic remains the fallback for albums the replay stage couldn't
    cover (no analyzed audio → no cluster assignment)."""
    user_ids = [r[0] for r in con.execute(
        text(
            "SELECT DISTINCT user_id FROM album"
            " WHERE status IN ('to_listen', 'listening')"
            " AND predicted_theme IS NOT NULL AND predicted_distinctness IS NOT NULL"
        )
    ).fetchall()]
    if only_user is not None:
        user_ids = [u for u in user_ids if u == only_user]

    for user_id in user_ids:
        theme_mu, theme_sd   = _factor_stats(con, "theme", user_id)
        replay_mu, replay_sd = _factor_stats(con, "replay_value", user_id)
        dist_mu, dist_sd     = _factor_stats(con, "distinctness", user_id)
        user_song_mean = con.execute(
            text(
                "SELECT AVG(s.score) FROM song s JOIN album a ON a.id=s.album_id"
                " WHERE a.status='rated' AND a.user_id = :uid AND s.score IS NOT NULL"
            ),
            {"uid": user_id},
        ).fetchone()[0] or 7.21

        unrated = con.execute(
            text(
                "SELECT id, artist, genre, predicted_theme, predicted_distinctness,"
                " predicted_song_mean, predicted_replay FROM album"
                " WHERE status IN ('to_listen', 'listening') AND user_id = :uid"
                " AND predicted_theme IS NOT NULL AND predicted_distinctness IS NOT NULL"
            ),
            {"uid": user_id},
        ).fetchall()

        for album_id, artist, genre, pred_theme, pred_dist, stored_song_mean, stored_replay in unrated:
            pred_replay = stored_replay if use_stored_replay else None

            if pred_replay is None:
                row = con.execute(
                    text("SELECT AVG(replay_value) FROM album WHERE status='rated' AND user_id = :uid AND replay_value IS NOT NULL AND artist = :artist"),
                    {"uid": user_id, "artist": artist},
                ).fetchone()
                pred_replay = row[0] if row and row[0] else None

            if pred_replay is None:
                row = con.execute(
                    text("SELECT AVG(replay_value) FROM album WHERE status='rated' AND user_id = :uid AND replay_value IS NOT NULL AND genre = :genre"),
                    {"uid": user_id, "genre": genre},
                ).fetchone()
                pred_replay = row[0] if row and row[0] else None

            if pred_replay is None:
                pred_replay = con.execute(
                    text("SELECT AVG(replay_value) FROM album WHERE status='rated' AND user_id = :uid AND replay_value IS NOT NULL"),
                    {"uid": user_id},
                ).fetchone()[0]

            if pred_replay is None:
                continue

            pred_replay = round(max(1.0, min(10.0, pred_replay)), 1)

            song_component = stored_song_mean if stored_song_mean is not None else user_song_mean
            if stored_song_mean is None:
                print(f"[recompute] album {album_id}: no ML song mean, using user_song_mean={round(user_song_mean, 3)}")

            z_theme  = (pred_theme  - theme_mu)  / theme_sd
            z_replay = (pred_replay - replay_mu) / replay_sd
            z_dist   = (pred_dist   - dist_mu)   / dist_sd
            # Capped at 10/10 — small-sample factor sds can inflate z-terms
            pred_score = min(round(1.0 * song_component + 0.25 * z_theme + 0.15 * z_replay + 0.05 * z_dist, 2), 10.0)

            con.execute(
                text("UPDATE album SET predicted_replay = :replay, predicted_score = :score WHERE id = :id"),
                {"replay": pred_replay, "score": pred_score, "id": album_id},
            )

    con.commit()
    print(f"[recompute_all_predictions] updated {len(unrated)} unrated albums")


def _factor_stats(con, field: str, user_id: int | None = None) -> tuple[float, float]:
    uid_filter = "AND user_id = :uid" if user_id is not None else ""
    params = {"uid": user_id} if user_id is not None else {}
    row = con.execute(text(f"""
        SELECT AVG({field}),
               AVG(({field}-(SELECT AVG({field}) FROM album WHERE {field} IS NOT NULL {uid_filter}))*
                   ({field}-(SELECT AVG({field}) FROM album WHERE {field} IS NOT NULL {uid_filter})))
        FROM album WHERE status='rated' AND {field} IS NOT NULL {uid_filter}
    """), params).fetchone()
    mu = row[0] or 5.0
    sd = math.sqrt(row[1]) if row[1] else 1.0
    return mu, sd




def _normalize_single(raw: float, all_raw: list[float], target_mu: float, target_sd: float) -> float:
    mu = sum(all_raw) / len(all_raw)
    sd = math.sqrt(sum((x - mu)**2 for x in all_raw) / len(all_raw)) or 1.0
    z = (raw - mu) / sd
    return round(max(1.0, min(10.0, z * target_sd + target_mu)))
