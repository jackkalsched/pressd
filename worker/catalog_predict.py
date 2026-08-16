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
    """One representative album row per distinct album, most-analyzed copy first.

    Copies of the same record carry the same audio (trackaudio is keyed by the
    global track), so the choice only affects how *complete* the tracklist is —
    hence picking the copy with the most analyzed tracks.
    """
    rows = con.execute(text("""
        SELECT a.id, a.artist, a.album_name, a.genre, a.year, a.album_art_url,
               COUNT(ta.track_id) AS n_analyzed
        FROM album a
        JOIN song s ON s.album_id = a.id
        LEFT JOIN trackaudio ta ON ta.track_id = s.track_id AND ta.bpm IS NOT NULL
        GROUP BY a.id, a.artist, a.album_name, a.genre, a.year, a.album_art_url
    """)).fetchall()

    best: dict[str, dict] = {}
    for aid, artist, album_name, genre, year, art, n_analyzed in rows:
        if not n_analyzed:
            continue  # nothing to predict from
        key = album_key(artist, album_name)
        cur = best.get(key)
        if cur is None or n_analyzed > cur["n_analyzed"]:
            best[key] = {
                "album_key": key, "album_id": aid, "artist": artist,
                "album_name": album_name, "genre": genre, "year": year,
                "album_art_url": art, "n_analyzed": n_analyzed,
            }
    return sorted(best.values(), key=lambda r: r["album_key"])


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

    scores = [p["score"] for p in params]
    spread = (max(scores) - min(scores)) if scores else 0.0
    print(f"[catalog_predict] user {user.id}: {len(params)} albums "
          f"[{um.source}] spread={spread:.2f}")
    return {"albums": len(params), "model": um.source, "spread": round(spread, 2)}


def predict_catalog(only_user: int | None = None, pooled=None,
                    dry_run: bool = False, clusters=None) -> dict:
    from song_score_model import album_frames, fit_for_user, fit_pooled_model
    from backend import scoring

    with engine.connect() as con:
        catalog = catalog_albums(con)
        print(f"[catalog_predict] catalog: {len(catalog)} distinct albums with analyzed audio")
        if dry_run:
            return {"catalog": len(catalog)}

        frame = album_frames(con, [r["album_id"] for r in catalog])
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
