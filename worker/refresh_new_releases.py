"""
Rebuild the For You "New & Popular" list and store it.

Runs every 6 hours in .github/workflows/new-releases.yml. The build is minutes
of paced Last.fm lookups (backend/new_releases.py explains why), which is why it
lives here and not in the request. The web endpoint only reads what this writes.

Fails loudly — exit 1, a red run in GitHub, status 'error' in workerrun — and
leaves the stored list untouched, so users keep the last good list while a
source is down instead of getting a thin or arbitrary one.

    python -m worker.refresh_new_releases            # build and store
    python -m worker.refresh_new_releases --dry-run  # build and print; store nothing
"""
import argparse
import asyncio
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlmodel import Session

import backend.models  # noqa: F401 — registers tables in SQLModel.metadata
from backend.database import engine
from backend.new_releases import build, write_stored
from worker import runlog


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="build and print; store nothing")
    args = ap.parse_args()

    run_id = None
    if not args.dry_run:
        with engine.connect() as con:
            run_id = runlog.start(con, "new_releases")

    def finish(status: str, **detail):
        if run_id is not None:
            with engine.connect() as con:
                runlog.finish(con, run_id, status, **detail)

    try:
        releases, source = asyncio.run(build(os.getenv("LASTFM_API_KEY")))
    except Exception as e:
        print(f"[new-releases] FAILED, stored list left as it was: {type(e).__name__}: {e}")
        finish("error", error=f"{type(e).__name__}: {e}"[:500])
        return 1

    print(f"[new-releases] {len(releases)} releases from {source}:")
    for i, r in enumerate(releases[:15], 1):
        signal = f"{r['listeners']:>7} listeners" if r.get("listeners") else f"{r.get('rater_count') or 0:>7} AOTY raters"
        print(f"  {i:>2}. {signal}  {r['artist']} — {r['album_name']}")

    if args.dry_run:
        return 0
    with Session(engine) as session:
        write_stored(session, releases)
    finish("ok", source=source, releases=len(releases),
           top=f"{releases[0]['artist']} — {releases[0]['album_name']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
