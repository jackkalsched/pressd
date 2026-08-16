"""
Nightly per-user prediction pipeline (PLAN_ml_worker_split §4).

Every stage that *measures an album* is shared across the userbase and paid for
once; every stage that *decides what a person thinks of it* is fitted per user.
That split is the whole design:

  1. song model → predicted_song_mean. Personal above ~1300 rated songs,
     otherwise the pooled userbase model calibrated onto the user's own scale,
     blended on a ramp between (song_score_model.fit_for_user).
  2. Claude analyses each album *once*, globally, into `albumfactors`: a vector
     of semantic thematic axes plus a distinctness scalar. No album is ever
     sent twice, and no user's name appears in the prompt.
  3. per-user factors — a ridge regression over those axes, fitted on the
     user's own theme ratings and blended with a pooled prior, so two users
     reading the same measurements reach different scores. Distinctness is only
     rescaled: it is worth 0.05 in a composite (theme_predictor.personalize).
  4. replay — the user's own mean for the artist, blended with their own mean
     over that artist's cluster-mates, where the clusters are KMeans over the
     whole artist dataset.
  5. composite predicted_score via backend.scoring — the same function that
     scores a rated album, including the user's factor weights.
  6. the whole catalog, not just this user's queue, into `albumprediction`.

A user whose rating counts haven't moved since their last successful run is
skipped; their album rows are still synced from the catalog first, so a newly
queued album picks up a prediction without refitting anything.

Each user runs inside their own try/except and logs to workerrun.

Usage:
    python -m worker.nightly_predict [--user 1] [--skip-llm]
"""
import argparse
import json
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlalchemy import text
import backend.models  # noqa: F401 — registers tables in SQLModel.metadata
from backend.database import engine
from worker import runlog

# Tier 1 gates all prediction output. It sat at 50 once, which meant one user in
# twenty ever got a prediction; then at 1, which produced predictions for anyone
# who had rated anything at all. The components that need a large personal
# library degrade rather than fail either way — the song model falls back to a
# pooled prior calibrated to the user (song_score_model.fit_for_user), and
# theme/distinctness to the global consensus mapped onto their scale
# (theme_predictor.personalize).
#
# The catch is what that fallback is made of. At one or two ratings the blend is
# almost entirely pooled, and the pool is one person's taste while the userbase
# is this small — so the prediction reads as a stranger's opinion wearing the
# user's name. Ten ratings is where enough of their own signal survives the
# blend to be worth showing.
MIN_RATED_ALBUMS = 10

# Retained for reporting only — fit_for_user now decides how much of the
# personal model to trust, on a ramp rather than a cliff.
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


def last_run_counts(con, user_id: int) -> tuple[int, int] | None:
    """(rated_albums, rated_songs) as of this user's last successful run, or
    None if they have never completed one.

    Read back out of workerrun.detail_json, which has recorded both numbers all
    along — no new bookkeeping table, and no reliance on album.date_rated,
    which is a DATE and so can't distinguish two runs on the same day.
    """
    row = con.execute(text(
        "SELECT detail_json FROM workerrun"
        " WHERE job = 'nightly_predict' AND user_id = :u AND status = 'ok'"
        " ORDER BY started_at DESC LIMIT 1"), {"u": user_id}).fetchone()
    if not row or not row[0]:
        return None
    try:
        d = json.loads(row[0])
        return int(d["rated_albums"]), int(d["rated_songs"])
    except (ValueError, KeyError, TypeError):
        return None


def sync_predictions_to_albums(con, user_id: int) -> int:
    """Copy this user's catalog predictions onto the album rows they own.

    The apps read `album.predicted_score`, so the catalog table alone would be
    invisible to them. Cheap enough to run even on a night the user is skipped,
    which is what lets a newly queued album show a prediction without refitting
    anything: the catalog was scored for every album, so the row already exists.
    """
    # album_key is the output of trackkeys.album_key (feat-credits and
    # punctuation stripped), so the match can't be expressed as a SQL join on
    # artist/album_name — it is resolved here and applied by id.
    from backend.trackkeys import album_key

    preds = {
        r[0]: r[1:] for r in con.execute(text(
            "SELECT album_key, predicted_song_mean, predicted_theme,"
            " predicted_distinctness, predicted_replay, predicted_score"
            " FROM albumprediction WHERE user_id = :u"), {"u": user_id}).fetchall()
    }
    if not preds:
        return 0

    rows = con.execute(text(
        "SELECT id, artist, album_name FROM album"
        " WHERE user_id = :u AND status IN ('to_listen', 'listening')"),
        {"u": user_id}).fetchall()

    updated = 0
    for album_id, artist, album_name in rows:
        p = preds.get(album_key(artist, album_name))
        if p is None:
            continue
        con.execute(text(
            "UPDATE album SET predicted_song_mean = :sm, predicted_theme = :t,"
            " predicted_distinctness = :d, predicted_replay = :r,"
            " predicted_score = :s WHERE id = :id"),
            {"sm": p[0], "t": p[1], "d": p[2], "r": p[3], "s": p[4], "id": album_id})
        updated += 1
    con.commit()
    return updated


def score_missing_globally(con, user_id: int) -> int:
    """Global theme + distinctness for any of the user's unrated albums that
    nobody has scored yet. One LLM pass per *album*, not per copy — an album
    another user already queued costs this user nothing."""
    from theme_predictor.global_factors import ensure_global_factors, get_global_factors

    rows = con.execute(text(
        "SELECT id, artist, album_name, year, genre FROM album"
        " WHERE user_id = :u AND status IN ('to_listen', 'listening')"
        " ORDER BY id"), {"u": user_id}).fetchall()

    scored = 0
    for album_id, artist, album_name, year, genre in rows:
        have = get_global_factors(con, artist, album_name)
        if have and have["theme_raw"] is not None and have["distinctness_raw"] is not None:
            continue
        ensure_global_factors(con, artist, album_name, year, genre, album_id)
        scored += 1
    return scored


def user_replay_by_artist(con, user_id: int) -> dict[str, float]:
    """{artist_key: mean replay} over one user's rated albums.

    Keyed canonically so it lines up with the cluster map. It previously used
    the raw `album.artist` string while the map was built from `song.artist`,
    so every lookup where the two disagreed silently missed.
    """
    from backend.trackkeys import artist_key
    out: dict[str, list[float]] = {}
    for r in con.execute(text(
            "SELECT artist, replay_value FROM album"
            " WHERE status='rated' AND user_id = :u AND replay_value IS NOT NULL"
            "   AND artist IS NOT NULL"), {"u": user_id}).fetchall():
        if r[1] is not None:
            out.setdefault(artist_key(r[0]), []).append(float(r[1]))
    return {k: sum(v) / len(v) for k, v in out.items()}


def predict_replay_all(con, user_id: int, um, clusters=None) -> int:
    """Replay prediction for all unrated albums.

    0.5·(the user's own mean for that artist) + 0.5·(their mean over the
    artist's cluster-mates). The clusters come from KMeans over the *whole*
    artist dataset, so "similar artist" is defined by everything the userbase
    has added rather than by one person's library — which is what lets a small
    library get a useful neighbourhood at all. The replay values averaged
    within that neighbourhood are strictly the user's own.

    Fallback chain when one side is missing: own mean alone, then cluster mean
    alone, then their genre mean, then their overall mean. Tiers 2-4 of that
    chain now live inside `clusters.cluster_value`, so what remains here is the
    0.5/0.5 blend and the final guard.
    """
    from backend.trackkeys import artist_key
    from worker.artist_clusters import user_replay_scale

    albums = con.execute(text(
        "SELECT id, artist, genre FROM album"
        " WHERE user_id = :u AND status IN ('to_listen', 'listening')"
        " ORDER BY id"), {"u": user_id}).fetchall()

    user_avg = con.execute(text(
        "SELECT AVG(replay_value) FROM album WHERE status='rated'"
        " AND user_id = :u AND replay_value IS NOT NULL"), {"u": user_id}).scalar()
    by_genre = {
        (r[0] or "").strip().lower(): float(r[1])
        for r in con.execute(text(
            "SELECT genre, AVG(replay_value) FROM album"
            " WHERE status='rated' AND user_id = :u AND replay_value IS NOT NULL"
            " GROUP BY genre"), {"u": user_id}).fetchall() if r[1] is not None
    }

    own_by_artist = user_replay_by_artist(con, user_id)
    if clusters is None and um is not None:
        clusters = getattr(um.taste, "clusters", None)
    # The user's *replay* scale, not their song-score scale: tier 3 maps replay
    # z-scores back, and the two distributions differ by up to 1.3 points.
    r_mu, r_sd = user_replay_scale(con, user_id)
    cluster_cache: dict[str, tuple[float, str] | None] = {}

    updated = 0
    for album_id, artist, genre in albums:
        key = artist_key(artist or "")
        own = own_by_artist.get(key)
        if clusters is None:
            hit = None
        elif key in cluster_cache:
            hit = cluster_cache[key]
        else:
            hit = clusters.cluster_value(key, own_by_artist, r_mu, r_sd)
            cluster_cache[key] = hit
        cluster, tier = (hit if hit else (None, None))

        if own is not None and cluster is not None:
            replay = 0.5 * own + 0.5 * cluster
        elif own is not None:
            replay, tier = own, "own"
        elif cluster is not None:
            replay = cluster
        else:
            replay = by_genre.get((genre or "").strip().lower(), user_avg)
            tier = "genre"
        if replay is None:
            continue

        con.execute(text(
            "UPDATE album SET predicted_replay = :r WHERE id = :id"),
            {"r": round(max(1.0, min(10.0, float(replay))), 1), "id": album_id})
        updated += 1

    con.commit()
    return updated


def run_user(user_id: int, skip_llm: bool = False, pooled=None,
             force: bool = False, catalog=None, frame=None,
             theme_features=None, pooled_theme=None, clusters=None) -> dict:
    """Full pipeline for one user. Fresh connection per stage — a nightly run
    can span long enough for the Supabase pooler to drop idle connections.

    `pooled`, `catalog` and `frame` are all userbase-wide and identical for
    every user, so main() builds them once and passes them down — rebuilding
    any of them per user would dominate the run.

    A user whose rating counts have not moved since their last successful run
    is skipped: refitting the same library on the same data produces the same
    model. Their album rows are still synced from the catalog predictions
    first, so an album queued since the last run picks up its prediction
    without anything being refit. `force` overrides the skip.
    """
    with engine.connect() as con:
        rated_albums, rated_songs = user_counts(con, user_id)

        if rated_albums < MIN_RATED_ALBUMS:
            run_id = runlog.start(con, "nightly_predict", user_id)
            runlog.finish(con, run_id, "below_threshold",
                          rated_albums=rated_albums, needed=MIN_RATED_ALBUMS)
            print(f"[nightly_predict] user {user_id}: {rated_albums}/{MIN_RATED_ALBUMS} "
                  f"rated albums — below threshold, skipped")
            return {"user_id": user_id, "status": "below_threshold"}

        # Newly queued albums inherit their prediction from the catalog even on
        # a night this user is skipped.
        synced = sync_predictions_to_albums(con, user_id)

        previous = last_run_counts(con, user_id)
        if previous == (rated_albums, rated_songs) and not force:
            print(f"[nightly_predict] user {user_id}: no new ratings since last run "
                  f"({rated_albums} albums / {rated_songs} songs) — skipped, "
                  f"{synced} album rows synced from the catalog")
            return {"user_id": user_id, "status": "unchanged", "synced": synced}

        run_id = runlog.start(con, "nightly_predict", user_id)

    detail = {"rated_albums": rated_albums, "rated_songs": rated_songs}
    try:
        from song_score_model import fit_for_user, repredict_all_song_means

        # 1. Song model — personal, blended, or the calibrated pooled prior,
        #    whichever the user's library supports. Always produces something,
        #    which is what makes per-album variation possible for a new user;
        #    the old path skipped this stage entirely and left every album
        #    sharing one constant song mean.
        um = None
        with engine.connect() as con:
            um = fit_for_user(con, user_id, pooled=pooled, clusters=clusters)
            if um is not None:
                detail["song_model"] = um.source
                detail["song_means"] = repredict_all_song_means(
                    con, user_id, um=um, recompute_composites=False)
            else:
                detail["song_means"] = "no model (no analyzed audio anywhere)"

        # 2. Global theme + distinctness for albums nobody has scored yet
        if not skip_llm:
            with engine.connect() as con:
                detail["globally_scored"] = score_missing_globally(con, user_id)

        # 3. Derive this user's theme/distinctness from the global scores
        #    (before composites — they z-score against predicted_theme).
        #    Replaces normalize_predicted_themes: Layer 1 already lands the
        #    value on the user's distribution, so a second normalisation pass
        #    would only add drift.
        from theme_predictor.predict_single import _recompute_unrated
        from theme_predictor.personalize import apply_user_factors, FactorPredictor
        with engine.connect() as con:
            predictor = FactorPredictor(con, user_id, features=theme_features,
                                        pooled_theme=pooled_theme)
            detail["personalize"] = apply_user_factors(con, user_id, predictor)

        # 4 + 5. Replay, then composite (reads the stored replay; 10.0 cap)
        with engine.connect() as con:
            detail["replay_albums"] = predict_replay_all(
                con, user_id, um, clusters=clusters)
            _recompute_unrated(con, only_user=user_id, use_stored_replay=True)
            con.commit()

        # 6. The whole catalog, not just this user's queue — every album anyone
        #    has added, scored against this user's model into albumprediction.
        if um is not None and catalog and frame is not None:
            try:
                from worker.catalog_predict import predict_catalog_for_user
                from backend import scoring
                from backend.models import PressUser
                from sqlmodel import Session

                with Session(engine) as session:
                    user = session.get(PressUser, user_id)
                    prior = scoring.get_global_factor_stats(session)
                    with engine.connect() as con:
                        detail["catalog"] = predict_catalog_for_user(
                            con, session, user, catalog, frame, um, prior,
                            predictor=predictor, clusters=clusters)
                # Surface the fresh catalog numbers on the album rows the apps
                # actually read.
                with engine.connect() as con:
                    detail["synced"] = sync_predictions_to_albums(con, user_id)
            except Exception as e:
                print(f"[nightly_predict] user {user_id}: catalog stage failed — {e}")
                detail["catalog"] = {"error": str(e)}

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
    ap.add_argument("--force", action="store_true",
                    help="refit even for users whose ratings haven't changed")
    args = ap.parse_args()

    if args.user:
        user_ids = [args.user]
    else:
        with engine.connect() as con:
            # Cast wide and let MIN_RATED_ALBUMS decide per user — being
            # selected here is not the same as being eligible. Note the gate
            # returns before sync_predictions_to_albums, so a user under the
            # threshold gets nothing at all this run, including a sync of
            # predictions the catalog may already hold for them.
            user_ids = [r[0] for r in con.execute(text(
                "SELECT DISTINCT user_id FROM album"
                " WHERE status IN ('rated', 'to_listen', 'listening')"
                " AND user_id IS NOT NULL ORDER BY user_id")).fetchall()]

    # Everything userbase-wide is built once here: the pooled prior, the
    # catalog, and the song frame every user's model predicts over.
    pooled, catalog, frame, clusters = None, None, None, None
    theme_features, pooled_theme = None, None
    try:
        from song_score_model import fit_pooled_model, album_frames
        from worker.artist_clusters import ArtistClusters
        from worker.catalog_predict import catalog_albums
        from theme_predictor.personalize import _features_by_key, fit_pooled_theme_model
        with engine.connect() as con:
            # Before the pooled model, because every model in this run borrows
            # it. One map, fit over every artist with analyzed audio and no
            # ratings of any kind, so "similar artist" means the same thing for
            # a user with 254 rated artists and one with three.
            clusters = ArtistClusters.fit(con)
            clusters.persist(con)
            print(f"[nightly_predict] artist map: {len(clusters.artists)} artists, "
                  f"k={clusters.k}, {len(clusters.maps)} seeds")
            pooled = fit_pooled_model(con, clusters=clusters)
            catalog = catalog_albums(con)
            frame = album_frames(con, [r["album_id"] for r in catalog])
            # The semantic axes and the pooled theme ridge are the same for
            # every user — fitted here, read many times below.
            theme_features = _features_by_key(con)
            pooled_theme = fit_pooled_theme_model(con, theme_features)
        print(f"[nightly_predict] catalog: {len(catalog)} albums, "
              f"{0 if frame is None else len(frame)} songs, "
              f"{len(theme_features)} analysed for theme")
    except Exception as e:
        print(f"[nightly_predict] userbase-wide setup failed ({e}) — "
              f"per-user stages will still run where they can")

    print(f"[nightly_predict] running for users: {user_ids}")
    results = [run_user(uid, skip_llm=args.skip_llm, pooled=pooled,
                        force=args.force, catalog=catalog, frame=frame,
                        theme_features=theme_features, pooled_theme=pooled_theme,
                        clusters=clusters)
               for uid in user_ids]
    n_ok = sum(1 for r in results if r["status"] == "ok")
    n_skip = sum(1 for r in results if r["status"] == "unchanged")
    print(f"[nightly_predict] done: {n_ok}/{len(results)} users ok, "
          f"{n_skip} unchanged since last run")


if __name__ == "__main__":
    main()
