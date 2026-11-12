"""
Catalog-wide prediction: every album in the dataset, for every user's model.

The `album.predicted_*` columns can only carry a prediction for a record the
user already has in their library, because they are columns on a per-user copy.
This stage predicts the *whole catalog* for each user — every distinct album
anyone has ever added — into `albumprediction`, keyed by (user_id, album_key).

Shape of the work, and why it is arranged this way:

  * One representative copy is chosen per album (the one with the most analyzed
    tracks), so 913 album rows collapse to ~830 records to score.
  * Their songs load in a single query, once, and every user's model predicts
    over that one frame in a single vectorised call. Per-album loading would
    mean one round trip per album per user — tens of thousands of them.
  * Replay and factor statistics are looked up from per-user dictionaries built
    once, rather than queried per album.
  * The bins' records are in the catalog too, whether or not anyone has added
    them (Jack's rule, November 2026): their songs are on Tracks of their own
    (BinTrack), so they are analysed and predicted exactly as a copy's are
    (bin_records). A song bin's songs also get their own per-song prediction
    (SongPrediction), read straight out of the same frame.

The composite deliberately calls backend.scoring, the same code that scores a
*rated* album, so a prediction and the eventual rating are computed on one
formula — including the user's own factor weights and their factor stats shrunk
toward the userbase prior. The older prediction path hardcoded 0.25/0.15/0.05
and skipped the shrinkage, so a prediction and its outcome were never quite on
the same scale.

Usage:
    python -m worker.catalog_predict              # every user
    python -m worker.catalog_predict --user 1
    python -m worker.catalog_predict --dry-run
"""
import argparse
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlalchemy import text
from sqlmodel import Session

import backend.models  # noqa: F401 — registers tables in SQLModel.metadata
from backend.database import engine
from backend.models import PressUser
from backend.trackkeys import album_key
from worker import runlog


def catalog_albums(con) -> list[dict]:
    """One representative album row per distinct album, most-analyzed copy first,
    then the bins' records nobody holds a copy of (bin_records).

    Copies of the same record carry the same audio (trackaudio is keyed by the
    global track), so the choice only affects how *complete* the tracklist is —
    hence picking the copy with the most analyzed tracks.
    """
    rows = con.execute(text("""
        SELECT a.id, a.artist, a.album_name, a.genre, a.year, a.album_art_url,
               a.subject_key, COUNT(ta.track_id) AS n_analyzed
        FROM album a
        JOIN song s ON s.album_id = a.id
        LEFT JOIN trackaudio ta ON ta.track_id = s.track_id AND ta.bpm IS NOT NULL
        GROUP BY a.id, a.artist, a.album_name, a.genre, a.year, a.album_art_url,
                 a.subject_key
    """)).fetchall()

    best: dict[str, dict] = {}
    for aid, artist, album_name, genre, year, art, subject, n_analyzed in rows:
        if not n_analyzed:
            continue  # nothing to predict from
        key = album_key(artist, album_name)
        cur = best.get(key)
        if cur is None or n_analyzed > cur["n_analyzed"]:
            best[key] = {
                "album_key": key, "album_id": aid, "artist": artist,
                "album_name": album_name, "genre": genre, "year": year,
                "album_art_url": art, "n_analyzed": n_analyzed,
                "subject_key": subject,
            }
    return sorted(best.values(), key=lambda r: r["album_key"]) + bin_records(con, list(best.values()))


def bin_records(con, copies: list[dict]) -> list[dict]:
    """The bins' records, as catalog rows, that no catalog copy stands for.

    Jack's rule (November 2026): every record in a bin is scored for every
    user's picks whether or not anyone has added it. A bin entry's songs are on
    Tracks (BinTrack, tracklink.link_bin_entries), so the nightly ingest
    analyses them and they are predicted exactly as a copy's are, from the
    entry's artist, title and the catalog's genre. A record someone holds in
    any edition is already here as that copy, so it isn't scored twice.
    `album_id` is the entry's id negated (song_score_model.bin_frames)."""
    rows = con.execute(text("""
        SELECT e.id, e.artist, e.album_name, e.year, e.subject_key, e.cover_url,
               e.tracklist_json, COUNT(ta.track_id) AS n_analyzed
        FROM binentry e
        JOIN bintrack bt ON bt.entry_id = e.id
        LEFT JOIN trackaudio ta ON ta.track_id = bt.track_id AND ta.bpm IS NOT NULL
        GROUP BY e.id
    """)).fetchall()
    # The artist's usual genre on Pressd, for a record whose catalog genre is
    # only "Alternative" — a qualifier, so no genre (genres.canonical_genre):
    # 114 of the first two bins' 297 records.
    from collections import Counter
    from backend.trackkeys import artist_key
    tally: dict[str, Counter] = {}
    for artist, genre, n in con.execute(text(
            "SELECT artist, genre, COUNT(*) FROM album WHERE genre IS NOT NULL"
            " GROUP BY artist, genre")).fetchall():
        tally.setdefault(artist_key(artist or ""), Counter())[genre] += n
    artist_genres = {k: c.most_common(1)[0][0] for k, c in tally.items()}
    return pick_bin_records(rows, copies, artist_genres)


def pick_bin_records(rows, copies: list[dict], artist_genres: dict | None = None) -> list[dict]:
    """One catalog row per bin record (`subject_key`) with analysed audio that
    no copy in `copies` covers, by subject key or album key: the entry with the
    most analysed tracks, then the earliest. `rows` are (id, artist,
    album_name, year, subject_key, cover_url, tracklist_json, n_analyzed). The
    genre is the catalog's, else `artist_genres`' for the artist (artist_key)."""
    import json
    from backend.genres import canonical_genre
    from backend.trackkeys import artist_key

    covered = {c.get("subject_key") for c in copies} | {c["album_key"] for c in copies}
    best: dict[str, dict] = {}
    for eid, artist, album_name, year, subject, cover, tl_json, n_analyzed in rows:
        if not n_analyzed or subject in covered:
            continue
        key = album_key(artist, album_name)
        if key in covered:
            continue
        cur = best.get(subject)
        if cur is not None and (cur["n_analyzed"], -cur["bin_entry_id"]) >= (n_analyzed, -eid):
            continue
        try:
            tl = json.loads(tl_json) if tl_json else {}
        except ValueError:
            tl = {}
        best[subject] = {
            "album_key": key, "album_id": -eid, "bin_entry_id": eid,
            "artist": artist, "album_name": album_name,
            "genre": (canonical_genre(tl.get("genre"))
                      or (artist_genres or {}).get(artist_key(artist or ""))),
            "year": year or tl.get("year"),
            "album_art_url": cover or tl.get("cover_url"), "n_analyzed": n_analyzed,
            "subject_key": subject,
        }
    return sorted(best.values(), key=lambda r: r["album_key"])


def catalog_frame(con, catalog: list[dict]):
    """The song frame every user's model predicts over: copies' songs
    (album_frames) and bin records' (bin_frames) in one."""
    import pandas as pd
    from song_score_model import album_frames, bin_frames

    parts = [
        album_frames(con, [r["album_id"] for r in catalog if r["album_id"] > 0]),
        bin_frames(con, [r for r in catalog if r.get("bin_entry_id")]),
    ]
    parts = [p for p in parts if p is not None]
    if not parts:
        return None
    return parts[0] if len(parts) == 1 else pd.concat(parts, ignore_index=True)


def song_bin_tracks(con) -> set[int]:
    """The recordings song bins name (BinEntry.track_id), whose own predicted
    scores the catalog stage stores (SongPrediction)."""
    return {r[0] for r in con.execute(text(
        "SELECT DISTINCT e.track_id FROM binentry e JOIN bin b ON b.id = e.bin_id"
        " WHERE b.item_type = 'song' AND e.track_id IS NOT NULL")).fetchall()}


def _replay_lookup(con, user_id: int):
    """(by_artist, by_genre, overall) replay means for one user.

    One artist dictionary now, keyed canonically. There used to be two —
    `by_artist` lowercased for the fallback chain and `by_artist_exact` for the
    cluster map — precisely because the two sides disagreed about case. Both are
    keyed on `artist_key` now, so the disagreement they worked around is gone.
    """
    from backend.trackkeys import artist_key
    acc: dict[str, list[float]] = {}
    for r in con.execute(text(
            "SELECT artist, replay_value FROM album"
            " WHERE status='rated' AND user_id=:u AND replay_value IS NOT NULL"
            "   AND artist IS NOT NULL"), {"u": user_id}).fetchall():
        if r[1] is not None:
            acc.setdefault(artist_key(r[0]), []).append(float(r[1]))
    by_artist = {k: sum(v) / len(v) for k, v in acc.items()}
    by_genre = {
        (r[0] or "").strip().lower(): float(r[1])
        for r in con.execute(text(
            "SELECT genre, AVG(replay_value) FROM album"
            " WHERE status='rated' AND user_id=:u AND replay_value IS NOT NULL"
            " GROUP BY genre"), {"u": user_id}).fetchall() if r[1] is not None
    }
    overall = con.execute(text(
        "SELECT AVG(replay_value) FROM album"
        " WHERE status='rated' AND user_id=:u AND replay_value IS NOT NULL"),
        {"u": user_id}).scalar()
    return (by_artist, by_genre, float(overall) if overall is not None else None)


def _rated_keys(con, user_id: int) -> set[str]:
    return {
        album_key(r[0], r[1])
        for r in con.execute(text(
            "SELECT artist, album_name FROM album"
            " WHERE user_id=:u AND status='rated'"), {"u": user_id}).fetchall()
    }


_UPSERT = text("""
    INSERT INTO albumprediction
        (user_id, album_key, artist, album_name, genre, year, album_art_url,
         predicted_song_mean, predicted_theme, predicted_distinctness,
         predicted_replay, predicted_score, model_source, replay_tier,
         already_rated, computed_at)
    VALUES (:user_id, :album_key, :artist, :album_name, :genre, :year, :album_art_url,
            :song_mean, :theme, :distinctness, :replay, :score, :model_source,
            :replay_tier, :already_rated, NOW())
    ON CONFLICT (user_id, album_key) DO UPDATE SET
        predicted_song_mean = EXCLUDED.predicted_song_mean,
        predicted_theme = EXCLUDED.predicted_theme,
        predicted_distinctness = EXCLUDED.predicted_distinctness,
        predicted_replay = EXCLUDED.predicted_replay,
        predicted_score = EXCLUDED.predicted_score,
        model_source = EXCLUDED.model_source,
        replay_tier = EXCLUDED.replay_tier,
        already_rated = EXCLUDED.already_rated,
        genre = EXCLUDED.genre,
        year = EXCLUDED.year,
        album_art_url = EXCLUDED.album_art_url,
        computed_at = NOW()
""")


_SONG_UPSERT = text("""
    INSERT INTO songprediction (user_id, track_id, predicted_score, model_source, computed_at)
    VALUES (:u, :t, :s, :m, NOW())
    ON CONFLICT (user_id, track_id) DO UPDATE SET
        predicted_score = EXCLUDED.predicted_score,
        model_source = EXCLUDED.model_source,
        computed_at = NOW()
""")


def predict_catalog_for_user(con, session, user, catalog, frame, um, prior,
                             predictor=None, clusters=None) -> dict:
    """Score the whole catalog for one user and upsert the rows."""
    from backend import scoring
    from backend.trackkeys import artist_key
    from theme_predictor.personalize import FactorPredictor
    from worker.artist_clusters import user_replay_scale

    # ── song means: one vectorised predict over the whole catalog frame ──
    work = frame.copy()
    work["_pred"] = um.predict_frame(work)
    song_means = work.groupby("album_id")["_pred"].mean().to_dict()

    # ── per-user lookups, built once ──
    if predictor is None:
        predictor = FactorPredictor(con, user.id)
    by_artist, by_genre, overall_replay = _replay_lookup(con, user.id)
    rated = _rated_keys(con, user.id)
    if clusters is None:
        clusters = getattr(um.taste, "clusters", None)
    # Replay scale, not song-score scale — see user_replay_scale.
    r_mu, r_sd = user_replay_scale(con, user.id)
    cluster_cache: dict[str, tuple[float, str] | None] = {}

    factor_stats = scoring.get_factor_stats(session, user_id=user.id, prior=prior)
    weights = scoring.get_user_weights(user)
    # No signal on production for an unheard album, so predict the user's mean:
    # its z-score is exactly 0 and the term drops out rather than guessing.
    production = factor_stats["production"][0]

    params = []
    for rec in catalog:
        song_mean = song_means.get(rec["album_id"])
        if song_mean is None:
            continue
        key = rec["album_key"]
        genre, year = rec["genre"], rec["year"]

        theme, dist = predictor.predict(key, genre, year)

        # Same rule as the queue path: the user's own mean for this artist,
        # blended with their own mean over the artist's cluster-mates, where
        # the clusters span the whole artist dataset.
        akey = artist_key(rec["artist"] or "")
        own = by_artist.get(akey)
        if akey in cluster_cache:
            hit = cluster_cache[akey]
        else:
            hit = (clusters.cluster_value(akey, by_artist, r_mu, r_sd)
                   if clusters is not None else None)
            cluster_cache[akey] = hit
        cluster, replay_tier = (hit if hit else (None, None))

        if own is not None and cluster is not None:
            replay = 0.5 * own + 0.5 * cluster
        else:
            replay = (own if own is not None else cluster)
            if cluster is None and own is not None:
                replay_tier = "own"
        if replay is None:
            replay = by_genre.get((genre or "").strip().lower()) or overall_replay
            replay_tier = "genre"

        # Any missing factor falls back to the user's mean for it, so the term
        # contributes nothing rather than dragging the composite toward a clamp.
        t = theme if theme is not None else factor_stats["theme"][0]
        d = dist if dist is not None else factor_stats["distinctness"][0]
        r = replay if replay is not None else factor_stats["replay_value"][0]

        score = scoring.compute_album_score(
            [float(song_mean)], t, r, production, d, factor_stats, weights)

        params.append({
            "user_id": user.id, "album_key": key,
            "artist": rec["artist"], "album_name": rec["album_name"],
            "genre": genre, "year": year, "album_art_url": rec["album_art_url"],
            "song_mean": round(float(song_mean), 4),
            "theme": t, "distinctness": d,
            "replay": round(float(r), 2) if r is not None else None,
            "score": score, "model_source": um.source,
            # Which tier of the cluster hierarchy answered — a 'global' replay
            # is a far weaker claim than a 'mates' one.
            "replay_tier": replay_tier,
            "already_rated": key in rated,
        })

    if params:
        con.execute(_UPSERT, params)
        con.commit()

    # A song bin's songs, each on its own: the mean of the recording's rows in
    # the frame (one per copy or bin entry holding it), on the user's song scale.
    songs = 0
    wanted = song_bin_tracks(con)
    if wanted and "track_id" in work.columns:
        per = work[work["track_id"].isin(wanted)].groupby("track_id")["_pred"].mean()
        song_params = [
            {"u": user.id, "t": int(tid), "s": round(min(10.0, max(1.0, float(v))), 2),
             "m": um.source}
            for tid, v in per.items()
        ]
        if song_params:
            con.execute(_SONG_UPSERT, song_params)
            con.commit()
            songs = len(song_params)

    scores = [p["score"] for p in params]
    spread = (max(scores) - min(scores)) if scores else 0.0
    bins = sum(1 for r in catalog if r.get("bin_entry_id") and r["album_id"] in song_means)
    print(f"[catalog_predict] user {user.id}: {len(params)} albums "
          f"({bins} from bins only), {songs} bin songs [{um.source}] spread={spread:.2f}")
    return {"albums": len(params), "bin_albums": bins, "bin_songs": songs,
            "model": um.source, "spread": round(spread, 2)}


def predict_catalog(only_user: int | None = None, pooled=None,
                    dry_run: bool = False, clusters=None) -> dict:
    from song_score_model import fit_for_user, fit_pooled_model
    from backend import scoring

    with engine.connect() as con:
        catalog = catalog_albums(con)
        n_bins = sum(1 for r in catalog if r.get("bin_entry_id"))
        print(f"[catalog_predict] catalog: {len(catalog)} distinct albums with analyzed audio "
              f"({n_bins} bin records nobody holds a copy of)")
        if dry_run:
            for r in [r for r in catalog if r.get("bin_entry_id")][:15]:
                print(f"   bin: {r['artist']} – {r['album_name']} "
                      f"({r['n_analyzed']} tracks analysed, {r['genre'] or 'no genre'})")
            return {"catalog": len(catalog), "bin_records": n_bins}

        frame = catalog_frame(con, catalog)
        if frame is None:
            print("[catalog_predict] no analyzed audio anywhere — nothing to do")
            return {"catalog": len(catalog), "users": 0}
        print(f"[catalog_predict] frame: {len(frame)} songs across "
              f"{frame['album_id'].nunique()} albums")

        # Standalone entry point: fit the map here, since no nightly run has
        # handed one down.
        if clusters is None:
            from worker.artist_clusters import ArtistClusters
            clusters = ArtistClusters.fit(con)
            clusters.persist(con)
            print(f"[catalog_predict] artist map: {len(clusters.artists)} artists, k={clusters.k}")
        if pooled is None:
            pooled = fit_pooled_model(con, clusters=clusters)

    out = {}
    with Session(engine) as session:
        prior = scoring.get_global_factor_stats(session)
        users = session.query(PressUser).order_by(PressUser.id).all()
        if only_user is not None:
            users = [u for u in users if u.id == only_user]

        for user in users:
            try:
                with engine.connect() as con:
                    um = fit_for_user(con, user.id, pooled=pooled, clusters=clusters)
                    if um is None:
                        print(f"[catalog_predict] user {user.id}: no model, skipped")
                        continue
                    out[user.id] = predict_catalog_for_user(
                        con, session, user, catalog, frame, um, prior,
                        clusters=clusters)
            except Exception as e:
                print(f"[catalog_predict] user {user.id} failed: {e}")
                out[user.id] = {"error": str(e)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", type=int, help="one user id only")
    ap.add_argument("--dry-run", action="store_true", help="report catalog size and stop")
    args = ap.parse_args()

    with engine.connect() as con:
        run_id = runlog.start(con, "catalog_predict", args.user)
    try:
        detail = predict_catalog(args.user, dry_run=args.dry_run)
        with engine.connect() as con:
            runlog.finish(con, run_id, "ok", users=len(detail))
    except Exception as e:
        with engine.connect() as con:
            runlog.finish(con, run_id, "error", error=str(e))
        raise


if __name__ == "__main__":
    main()
