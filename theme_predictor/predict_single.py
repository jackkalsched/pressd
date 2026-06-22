"""
Predict theme, replay, distinctness, and album score for a single album.
Called as a background task when a new to_listen album is added.
"""

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


def _ensure_ollama() -> bool:
    """Start Ollama if it isn't responding. Returns True when ready."""
    import subprocess, time, urllib.request, urllib.error
    def _ping():
        try:
            urllib.request.urlopen("http://localhost:11434/", timeout=3)
            return True
        except Exception:
            return False

    if _ping():
        return True

    print("[predict_single] Ollama not running — starting it...")
    try:
        subprocess.Popen(
            ["ollama", "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except FileNotFoundError:
        print("[predict_single] ollama not found in PATH — skipping LLM steps")
        return False

    for _ in range(30):
        time.sleep(2)
        if _ping():
            print("[predict_single] Ollama ready")
            return True

    print("[predict_single] Ollama did not start in time — skipping LLM steps")
    return False


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

        # ── Ensure Ollama is running before LLM steps ────────────────────────────
        ollama_ready = _ensure_ollama()

        # ── 3. Theme (requires Ollama) ────────────────────────────────────────────
        if not ollama_ready:
            print("[predict_single] skipping theme (Ollama unavailable)")
        else:
            try:
                from .corpus import load_or_build_corpus, build_document
                from .embedder import get_collection, upsert_corpus, top_similar_albums
                from .predictor import predict_theme

                corpus = load_or_build_corpus(album_id, artist, album_name, year, None)
                corpus["genre"] = genre

                rated = con.execute(
                    text("SELECT id, artist, album_name, year, genre, theme FROM album WHERE status='rated' AND theme IS NOT NULL")
                ).fetchall()
                corpora_map: dict[int, dict] = {}
                for aid, a_artist, a_album, a_year, a_genre, a_theme in rated:
                    c = load_or_build_corpus(aid, a_artist, a_album, a_year, a_theme)
                    c["genre"] = a_genre
                    corpora_map[aid] = c

                collection = get_collection()
                upsert_corpus(collection, corpus, build_document(corpus))

                examples = top_similar_albums(collection, build_document(corpus), n_albums=3)
                example_dicts = [
                    {"album_id": ex["album_id"], "artist": ex["artist"],
                     "album_name": ex["album_name"], "theme_score": ex["theme_score"]}
                    for ex in examples if ex["album_id"] in corpora_map
                ]

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

        # ── 4. Distinctness (requires Ollama) ─────────────────────────────────────
        if not ollama_ready:
            print("[predict_single] skipping distinctness (Ollama unavailable)")
        else:
            try:
                from .corpus import load_or_build_corpus, build_document
                from .embedder import get_collection, top_similar_albums
                from .distinctness_predictor import predict_distinctness

                corpus = load_or_build_corpus(album_id, artist, album_name, year, None)
                corpus["genre"] = genre
                collection = get_collection()
                doc = build_document(corpus)
                examples = top_similar_albums(collection, doc, n_albums=3)

                d_corpora: dict[int, dict] = {}
                d_rated = con.execute(
                    text("SELECT id, artist, album_name, year, genre, distinctness FROM album WHERE status='rated' AND distinctness IS NOT NULL")
                ).fetchall()
                for aid, a_artist, a_album, a_year, a_genre, a_dist in d_rated:
                    c = load_or_build_corpus(aid, a_artist, a_album, a_year, None)
                    c["genre"] = a_genre
                    c["theme_score"] = a_dist
                    d_corpora[aid] = c

                d_examples = [
                    {"album_id": ex["album_id"], "artist": ex["artist"],
                     "album_name": ex["album_name"], "theme_score": d_corpora[ex["album_id"]]["theme_score"]}
                    for ex in examples if ex["album_id"] in d_corpora
                ]

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

        # ── 5. Replay ─────────────────────────────────────────────────────────────
        try:
            from generate_genres_lastfm import infer_genres

            artist_row = con.execute(
                text("SELECT AVG(replay_value) FROM album WHERE status='rated' AND replay_value IS NOT NULL AND artist = :artist"),
                {"artist": artist},
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
                        text("SELECT AVG(replay_value) FROM album WHERE status='rated' AND replay_value IS NOT NULL AND genre = :genre"),
                        {"genre": inferred_genre},
                    ).fetchone()
                    artist_replay = genre_row[0] if genre_row and genre_row[0] else None
                except Exception:
                    pass

            if artist_replay is None:
                artist_replay = con.execute(
                    text("SELECT AVG(replay_value) FROM album WHERE status='rated' AND replay_value IS NOT NULL")
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
                pred_score = round(1.0 * song_component + 0.25 * z_theme + 0.15 * z_replay + 0.05 * z_dist, 2)
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


def normalize_predicted_themes():
    """Remap all predicted_theme values so their distribution matches the user's actual
    theme rating distribution. Prevents LLM scores from being systematically biased."""
    with engine.connect() as con:
        user_ids = [r[0] for r in con.execute(
            text("SELECT DISTINCT user_id FROM album WHERE status='to_listen' AND predicted_theme IS NOT NULL")
        ).fetchall()]
        for user_id in user_ids:
            target_mu, target_sd = _factor_stats(con, "theme", user_id)
            rows = con.execute(
                text("SELECT id, predicted_theme FROM album WHERE user_id=:uid AND status='to_listen' AND predicted_theme IS NOT NULL"),
                {"uid": user_id},
            ).fetchall()
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


def _recompute_unrated(con):
    # Get all distinct users who have unrated albums with predictions
    user_ids = [r[0] for r in con.execute(
        text(
            "SELECT DISTINCT user_id FROM album"
            " WHERE status='to_listen' AND predicted_theme IS NOT NULL AND predicted_distinctness IS NOT NULL"
        )
    ).fetchall()]

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
                "SELECT id, artist, genre, predicted_theme, predicted_distinctness, predicted_song_mean FROM album"
                " WHERE status='to_listen' AND user_id = :uid"
                " AND predicted_theme IS NOT NULL AND predicted_distinctness IS NOT NULL"
            ),
            {"uid": user_id},
        ).fetchall()

        for album_id, artist, genre, pred_theme, pred_dist, stored_song_mean in unrated:
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
            pred_score = round(1.0 * song_component + 0.25 * z_theme + 0.15 * z_replay + 0.05 * z_dist, 2)

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
