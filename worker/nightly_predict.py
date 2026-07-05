"""
Nightly per-user prediction pipeline (PLAN_ml_worker_split §4).

For every user past the unlock threshold, strictly on that user's own data:
  1. song score model (if past the ML tier) → predicted_song_mean for all
     to_listen/listening albums with analyzed audio
  2. theme + distinctness (Claude) for albums missing them — already-predicted
     albums are never re-sent to the LLM
  3. theme normalization against the user's own rating distribution
  4. cluster-based replay prediction (50/50 own/cluster blend for known
     artists, pure cluster mean for new ones, heuristic chain as fallback)
  5. composite predicted_score, capped at 10.0

Each user runs inside their own try/except and logs to workerrun.

Usage:
    python -m worker.nightly_predict [--user 1] [--skip-llm]
"""
import argparse
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlalchemy import text
import backend.models  # noqa: F401 — registers tables in SQLModel.metadata
from backend.database import engine
from worker import runlog

# Unlock tiers (PLAN §5). Tier 1 gates all prediction output; tier 2 turns on
# the per-user LightGBM in place of the user-mean song component.
MIN_RATED_ALBUMS = 50
MIN_RATED_SONGS_FOR_ML = 1300


def user_counts(con, user_id: int) -> tuple[int, int]:
    rated_albums = con.execute(text(
        "SELECT COUNT(*) FROM album WHERE user_id = :u AND status = 'rated'"),
        {"u": user_id}).scalar()
    rated_songs = con.execute(text(
        "SELECT COUNT(*) FROM song s"
        " JOIN album a ON a.id = s.album_id"
        " JOIN trackaudio ta ON ta.track_id = s.track_id"
        " WHERE a.user_id = :u AND s.score IS NOT NULL AND ta.bpm IS NOT NULL"),
        {"u": user_id}).scalar()
    return rated_albums or 0, rated_songs or 0


def predict_missing_llm(con, user_id: int) -> int:
    """Theme + distinctness for the user's unrated albums that lack them."""
    from theme_predictor.predict_single import predict_llm_factors

    rows = con.execute(text(
        "SELECT id, artist, album_name, year, genre FROM album"
        " WHERE user_id = :u AND status IN ('to_listen', 'listening')"
        " AND (predicted_theme IS NULL OR predicted_distinctness IS NULL)"
        " ORDER BY id"), {"u": user_id}).fetchall()

    for album_id, artist, album_name, year, genre in rows:
        predict_llm_factors(con, album_id, artist, album_name, year, genre, user_id)
    return len(rows)


def predict_replay_all(con, user_id: int, um) -> int:
    """Cluster-based replay prediction (PLAN §4.4) for all unrated albums.

    Existing artist → 0.5·own replay mean + 0.5·artist-cluster replay mean;
    new artist → cluster mean (clusters were extended during the song-mean
    stage); fallbacks: own mean alone, then genre mean, then user mean."""
    from song_score_model import artist_cluster_replay_mean

    albums = con.execute(text(
        "SELECT id, artist, genre FROM album"
        " WHERE user_id = :u AND status IN ('to_listen', 'listening')"
        " ORDER BY id"), {"u": user_id}).fetchall()

    user_avg = con.execute(text(
        "SELECT AVG(replay_value) FROM album WHERE status='rated'"
        " AND user_id = :u AND replay_value IS NOT NULL"), {"u": user_id}).scalar()

    updated = 0
    for album_id, artist, genre in albums:
        own = con.execute(text(
            "SELECT AVG(replay_value) FROM album WHERE status='rated'"
            " AND user_id = :u AND replay_value IS NOT NULL AND artist = :a"),
            {"u": user_id, "a": artist}).scalar()
        cluster = (artist_cluster_replay_mean(um.df, um.taste, artist)
                   if um is not None else None)

        if own is not None and cluster is not None:
            replay = 0.5 * own + 0.5 * cluster
        elif own is not None:
            replay = own
        elif cluster is not None:
            replay = cluster
        else:
            replay = con.execute(text(
                "SELECT AVG(replay_value) FROM album WHERE status='rated'"
                " AND user_id = :u AND replay_value IS NOT NULL AND genre = :g"),
                {"u": user_id, "g": genre or ""}).scalar()
            if replay is None:
                replay = user_avg
        if replay is None:
            continue

        con.execute(text(
            "UPDATE album SET predicted_replay = :r WHERE id = :id"),
            {"r": round(max(1.0, min(10.0, float(replay))), 1), "id": album_id})
        updated += 1

    con.commit()
    return updated


def run_user(user_id: int, skip_llm: bool = False) -> dict:
    """Full pipeline for one user. Fresh connection per stage — a nightly run
    can span long enough for the Supabase pooler to drop idle connections."""
    with engine.connect() as con:
        rated_albums, rated_songs = user_counts(con, user_id)

        if rated_albums < MIN_RATED_ALBUMS:
            run_id = runlog.start(con, "nightly_predict", user_id)
            runlog.finish(con, run_id, "below_threshold",
                          rated_albums=rated_albums, needed=MIN_RATED_ALBUMS)
            print(f"[nightly_predict] user {user_id}: {rated_albums}/{MIN_RATED_ALBUMS} "
                  f"rated albums — below threshold, skipped")
            return {"user_id": user_id, "status": "below_threshold"}

        run_id = runlog.start(con, "nightly_predict", user_id)

    detail = {"rated_albums": rated_albums, "rated_songs": rated_songs}
    try:
        from song_score_model import fit_user_model, repredict_all_song_means

        # 1. Song score model (tier 2 gate)
        um = None
        if rated_songs >= MIN_RATED_SONGS_FOR_ML:
            with engine.connect() as con:
                um = fit_user_model(con, user_id)
                if um is not None:
                    r = repredict_all_song_means(con, user_id, um=um,
                                                 recompute_composites=False)
                    detail["song_means"] = r
        else:
            detail["song_means"] = f"skipped (<{MIN_RATED_SONGS_FOR_ML} songs)"

        # 2. Theme + distinctness for albums missing them
        if not skip_llm:
            with engine.connect() as con:
                detail["llm_albums"] = predict_missing_llm(con, user_id)

        # 3. Normalize predicted themes to the user's own distribution
        #    (before composites — they z-score against predicted_theme)
        from theme_predictor.predict_single import (
            normalize_predicted_themes, _recompute_unrated)
        normalize_predicted_themes(only_user=user_id)

        # 4 + 5. Replay, then composite (reads the stored replay; 10.0 cap)
        with engine.connect() as con:
            detail["replay_albums"] = predict_replay_all(con, user_id, um)
            _recompute_unrated(con, only_user=user_id, use_stored_replay=True)
            con.commit()

        with engine.connect() as con:
            runlog.finish(con, run_id, "ok", **detail)
        print(f"[nightly_predict] user {user_id}: ok — {detail}")
        return {"user_id": user_id, "status": "ok", **detail}

    except Exception as e:
        try:
            with engine.connect() as con:
                runlog.finish(con, run_id, "error", error=str(e), **detail)
        except Exception:
            pass
        print(f"[nightly_predict] user {user_id}: FAILED — {e}")
        return {"user_id": user_id, "status": "error", "error": str(e)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", type=int, help="run for one user id only")
    ap.add_argument("--skip-llm", action="store_true",
                    help="skip Claude theme/distinctness calls (dry runs)")
    args = ap.parse_args()

    if args.user:
        user_ids = [args.user]
    else:
        with engine.connect() as con:
            user_ids = [r[0] for r in con.execute(text(
                "SELECT DISTINCT user_id FROM album WHERE status = 'rated'"
                " AND user_id IS NOT NULL ORDER BY user_id")).fetchall()]

    print(f"[nightly_predict] running for users: {user_ids}")
    results = [run_user(uid, skip_llm=args.skip_llm) for uid in user_ids]
    n_ok = sum(1 for r in results if r["status"] == "ok")
    print(f"[nightly_predict] done: {n_ok}/{len(results)} users ok")


if __name__ == "__main__":
    main()
