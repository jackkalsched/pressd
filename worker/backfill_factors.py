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
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlalchemy import text
import backend.models  # noqa: F401 — registers tables in SQLModel.metadata
from backend.database import engine
from worker import runlog


def backfill(limit: int | None = None, dry_run: bool = False) -> dict:
    from theme_predictor.global_factors import albums_missing_factors, ensure_global_factors

    with engine.connect() as con:
        todo = albums_missing_factors(con, limit)

    print(f"[backfill_factors] {len(todo)} distinct albums need global scoring")
    if dry_run:
        for aid, artist, album_name, year, genre in todo[:40]:
            print(f"   {artist} – {album_name} ({year or '?'}, {genre or 'no genre'})")
        if len(todo) > 40:
            print(f"   … and {len(todo) - 40} more")
        return {"pending": len(todo), "scored": 0}

    scored, failed = 0, 0
    for i, (aid, artist, album_name, year, genre) in enumerate(todo, 1):
        print(f"[backfill_factors] [{i}/{len(todo)}] {artist} – {album_name}")
        # Fresh connection per album: a full backfill runs long enough for the
        # Supabase pooler to drop an idle one.
        try:
            with engine.connect() as con:
                got = ensure_global_factors(con, artist, album_name, year, genre, aid)
            if got and (got["theme_raw"] is not None or got["distinctness_raw"] is not None):
                scored += 1
            else:
                failed += 1
        except Exception as e:
            print(f"[backfill_factors] failed: {e}")
            failed += 1

    print(f"[backfill_factors] done: {scored} scored, {failed} failed")
    return {"pending": len(todo), "scored": scored, "failed": failed}


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
    args = ap.parse_args()

    if args.apply:
        apply_all(args.user)
        return

    with engine.connect() as con:
        run_id = runlog.start(con, "backfill_factors", None)
    try:
        detail = backfill(args.limit, args.dry_run)
        with engine.connect() as con:
            runlog.finish(con, run_id, "ok", **detail)
    except Exception as e:
        with engine.connect() as con:
            runlog.finish(con, run_id, "error", error=str(e))
        raise


if __name__ == "__main__":
    main()
