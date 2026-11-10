"""
Rebuild the upcoming-releases list (backend/upcoming_releases.py) and store it.

Runs daily in .github/workflows/upcoming-releases.yml: releases are announced a
few a day, and the build is minutes of paced Deezer, iTunes and Last.fm
lookups, which is why it lives here and not in the request. The endpoint only
reads what this writes, and drops what has come out since.

Fails loudly — exit 1, a red run in GitHub, status 'error' in workerrun — and
leaves the stored list untouched, so the calendar keeps the last good list
while a source is down instead of a thin one.

    python -m worker.refresh_upcoming_releases            # build and store
    python -m worker.refresh_upcoming_releases --dry-run  # build and print; store nothing
"""
import argparse
import asyncio
import os
import pathlib
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlmodel import Session

import backend.models  # noqa: F401 — registers tables in SQLModel.metadata
from backend import upcoming_releases
from backend.database import engine
from backend.upcoming_releases import build, write_stored
from worker import runlog


def summary(rows: list[dict]) -> dict:
    """What the run's workerrun row says about the list — enough to judge it
    without opening the payload."""
    notable = [r for r in rows if r["notable"]]
    weeks = Counter(r["release_date"][:7] for r in rows)
    return {
        "releases": len(rows),
        "notable": len(notable),
        "by_type": dict(Counter(r["type"] for r in rows)),
        "secondary": sum(1 for r in rows if r.get("secondary")),
        "with_cover": sum(1 for r in rows if r["cover_url"]),
        "notable_with_cover": sum(1 for r in notable if r["cover_url"]),
        "notable_importable": sum(1 for r in notable if r["deezer_id"]),
        "wikipedia_only": sum(1 for r in rows if r["sources"][0] == "wikipedia"),
        "by_month": dict(sorted(weeks.items())),
        "first": rows[0]["release_date"] if rows else None,
        "last": rows[-1]["release_date"] if rows else None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="build and print; store nothing")
    args = ap.parse_args()

    run_id = None
    if not args.dry_run:
        with engine.connect() as con:
            run_id = runlog.start(con, "upcoming_releases")

    def finish(status: str, **detail):
        if run_id is not None:
            with engine.connect() as con:
                runlog.finish(con, run_id, status, **detail)

    try:
        rows = asyncio.run(build(os.getenv("LASTFM_API_KEY")))
    except Exception as e:
        print(f"[upcoming] FAILED, stored list left as it was: {type(e).__name__}: {e}")
        finish("error", error=f"{type(e).__name__}: {e}"[:500], sources=dict(upcoming_releases.LAST_TALLY))
        return 1

    detail = summary(rows)
    print(f"[upcoming] {detail['releases']} releases, {detail['notable']} notable, "
          f"{detail['first']} → {detail['last']}; sources {dict(upcoming_releases.LAST_TALLY)}")
    for k, v in detail.items():
        if k not in ("releases", "notable", "first", "last"):
            print(f"  {k}: {v}")
    for r in [r for r in rows if r["notable"]][:15]:
        print(f"  {r['release_date']}  {r['type']:<6} {r['artist']} — {r['title']}"
              f"  ({r['artist_listeners'] or 0:,} listeners; {'+'.join(r['sources'])})")

    if args.dry_run:
        return 0
    with Session(engine) as session:
        write_stored(session, rows)
    finish("ok", **detail, sources=dict(upcoming_releases.LAST_TALLY))
    return 0


if __name__ == "__main__":
    sys.exit(main())
