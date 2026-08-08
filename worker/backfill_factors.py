"""
One-time (then incremental) global theme/distinctness backfill.

Scores every distinct album in the userbase into `albumfactors` — copies
collapse to one call, so this is bounded by the catalog size, not by the
number of album rows or users. Re-running only picks up what's still missing,
so it is safe to interrupt and resume.

After the backfill, `--apply` derives each user's own values from the global
scores (Layer 1 for everyone, Layer 2 past the gate) without any further LLM
calls, so it is cheap to re-run whenever ratings change.

Usage:
    python -m worker.backfill_factors --dry-run        # what would be scored
    python -m worker.backfill_factors --limit 25       # score 25 albums
    python -m worker.backfill_factors                  # score everything missing
    python -m worker.backfill_factors --apply          # derive per-user values
    python -m worker.backfill_factors --apply --user 1
"""
import argparse
import itertools
import sys
import pathlib
import threading
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlalchemy import text
import backend.models  # noqa: F401 — registers tables in SQLModel.metadata
from backend.database import engine
from worker import runlog


# Supabase's session-mode pooler allows 15 clients across the entire project —
# the live web service included — and backend.database's engine is configured
# for pool_size(5) + max_overflow(10), which is exactly that ceiling on its own.
# A first attempt at six workers holding a connection across their LLM calls
# took the pooler to EMAXCONNSESSION and locked the app out of its own database.
#
# So: workers never hold a connection while waiting on the model (see
# global_factors.analyze_album), and the count stays low enough that the
# millisecond-long writes cannot collide into the app's headroom.
WORKERS = 4

# Stop the run after this many albums in a row score nothing. An exhausted API
# budget, a dead key and a provider outage are indistinguishable per album and
# none of them recover on their own.
ABORT_AFTER_CONSECUTIVE_FAILURES = 8


def backfill(limit: int | None = None, dry_run: bool = False,
             workers: int = WORKERS) -> dict:
    from theme_predictor.global_factors import (
        albums_missing_factors, analyze_album, store_global_factors,
        _anchor_examples, _corpora_for)
    from theme_predictor.predictor import LLM_MODEL
    from backend.trackkeys import album_key

    with engine.connect() as con:
        todo = albums_missing_factors(con, limit)
        # The distinctness anchor set is the same for every album of a given
        # genre and costs a full table scan, so it is built once here rather
        # than inside each worker.
        anchors = _anchor_examples(con, "distinctness", None)
    anchor_corpora = _corpora_for(anchors)

    print(f"[backfill_factors] {len(todo)} distinct albums need global scoring")
    if dry_run:
        for aid, artist, album_name, year, genre in todo[:40]:
            print(f"   {artist} – {album_name} ({year or '?'}, {genre or 'no genre'})")
        if len(todo) > 40:
            print(f"   … and {len(todo) - 40} more")
        return {"pending": len(todo), "scored": 0}

    done = itertools.count(1)

    aborted = threading.Event()
    streak_lock = threading.Lock()
    consecutive = [0]

    def note(ok: bool, why: str | None):
        """Track consecutive failures and trip the breaker on a run of them.

        A budget that runs dry, an expired key, or a provider outage all look
        the same from one album: nothing scored. The difference is that they
        do not recover, and without this the run works through every remaining
        album producing nothing — which is exactly what happened on the first
        full attempt, for 140 albums, while reporting zero failures.
        """
        with streak_lock:
            if ok:
                consecutive[0] = 0
                return
            consecutive[0] += 1
            if consecutive[0] >= ABORT_AFTER_CONSECUTIVE_FAILURES and not aborted.is_set():
                aborted.set()
                print(f"\n[backfill_factors] ABORTING — "
                      f"{consecutive[0]} albums in a row scored nothing.\n"
                      f"[backfill_factors] last error: {why or '(no exception; '
                      f'the model returned an unparseable response)'}\n"
                      f"[backfill_factors] already-scored albums are kept; re-run to resume.",
                      flush=True)

    def one(rec):
        aid, artist, album_name, year, genre = rec
        if aborted.is_set():
            return None                      # distinct from a real failure
        i = next(done)
        try:
            # No connection held here — this is the slow part.
            got = analyze_album(artist, album_name, year, genre, aid,
                                anchors, anchor_corpora)
            ok = bool(got["theme_features"] is not None
                      or got["distinctness_raw"] is not None)
            if ok:
                # ...and only now, for the length of one INSERT.
                with engine.connect() as con:
                    store_global_factors(
                        con, album_key(artist, album_name), artist, album_name,
                        genre, year, got["theme_features"], got["theme_raw"],
                        got["theme_reasoning"], got["distinctness_raw"],
                        got["distinctness_reasoning"], LLM_MODEL)
            note(ok, got.get("error"))
        except Exception as e:
            print(f"[backfill_factors] [{i}/{len(todo)}] FAILED {artist} – {album_name}: "
                  f"{type(e).__name__}: {e}", flush=True)
            note(False, f"{type(e).__name__}: {e}")
            return False
        if i % 25 == 0 or not ok:
            print(f"[backfill_factors] [{i}/{len(todo)}] {artist} – {album_name}"
                  f"{'' if ok else '  <-- nothing scored: ' + (got.get('error') or 'unparseable response')}",
                  flush=True)
        return ok

    with ThreadPoolExecutor(max_workers=workers) as ex:
        results = list(ex.map(one, todo))

    scored = sum(1 for r in results if r is True)
    failed = sum(1 for r in results if r is False)
    skipped = sum(1 for r in results if r is None)
    tail = f", {skipped} not attempted (aborted)" if skipped else ""
    print(f"[backfill_factors] done: {scored} scored, {failed} failed{tail}")
    return {"pending": len(todo), "scored": scored, "failed": failed,
            "skipped": skipped, "aborted": aborted.is_set()}


def apply_all(only_user: int | None = None) -> dict:
    """Derive per-user theme/distinctness from the global scores. No LLM."""
    from theme_predictor.personalize import apply_user_factors, MIN_ALBUMS_FOR_THEME_RIDGE

    with engine.connect() as con:
        user_ids = [r[0] for r in con.execute(text(
            "SELECT DISTINCT user_id FROM album"
            " WHERE status IN ('to_listen', 'listening') AND user_id IS NOT NULL"
            " ORDER BY user_id")).fetchall()]
    if only_user is not None:
        user_ids = [u for u in user_ids if u == only_user]

    print(f"[backfill_factors] applying to users: {user_ids} "
          f"(personal theme ridge from {MIN_ALBUMS_FOR_THEME_RIDGE} rated albums)")
    out = {}
    for uid in user_ids:
        try:
            with engine.connect() as con:
                out[uid] = apply_user_factors(con, uid)
        except Exception as e:
            print(f"[backfill_factors] user {uid} failed: {e}")
            out[uid] = {"error": str(e)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, help="score at most N albums this run")
    ap.add_argument("--dry-run", action="store_true", help="list what would be scored")
    ap.add_argument("--apply", action="store_true",
                    help="derive per-user values from the global scores (no LLM)")
    ap.add_argument("--user", type=int, help="with --apply, one user only")
    ap.add_argument("--workers", type=int, default=WORKERS,
                    help=f"concurrent albums (default {WORKERS})")
    args = ap.parse_args()

    if args.apply:
        apply_all(args.user)
        return

    with engine.connect() as con:
        run_id = runlog.start(con, "backfill_factors", None)
    try:
        detail = backfill(args.limit, args.dry_run, args.workers)
        with engine.connect() as con:
            runlog.finish(con, run_id, "ok", **detail)
    except Exception as e:
        with engine.connect() as con:
            runlog.finish(con, run_id, "error", error=str(e))
        raise


if __name__ == "__main__":
    main()
