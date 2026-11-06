"""Look again for a cover for every album copy that has none.

Runs daily in .github/workflows/fill-covers.yml. A record imported on its
release day often has no art in any catalog yet; this is what picks it up once one publishes it (backend/covers.py has the
sources and why). Each run is a `workerrun` row, job 'fill_covers'.

    python -m worker.fill_covers            # look and store
    python -m worker.fill_covers --dry-run  # list what's missing; store nothing
"""
import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlmodel import Session

import backend.models  # noqa: F401 — registers tables in SQLModel.metadata
from backend import covers
from backend.database import engine
from worker import runlog


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="count what's missing; store nothing")
    args = ap.parse_args()

    with Session(engine) as session:
        albums = covers.coverless(session)
        print(f"[fill-covers] {len(albums)} copies without a cover")
        if args.dry_run:
            return 0
        with engine.connect() as con:
            run_id = runlog.start(con, "fill_covers")
        try:
            result = covers.fill(session, albums)
        except Exception as e:
            with engine.connect() as con:
                runlog.finish(con, run_id, "error", error=f"{type(e).__name__}: {e}"[:500])
            raise
    print(f"[fill-covers] {result['updated']} filled, {result['missing']} still missing")
    with engine.connect() as con:
        runlog.finish(con, run_id, "ok", coverless=len(albums), **result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
