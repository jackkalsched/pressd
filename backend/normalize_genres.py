"""One-off backfill: fold existing albums onto the canonical genre spellings.

The write paths normalize going forward (see backend/genres.py), but rows added
before that still carry whatever their source spelled. Run once after deploying:

    python -m backend.normalize_genres --dry-run   # show what would change
    python -m backend.normalize_genres             # apply

Idempotent — a second run reports nothing to do.
"""
import argparse

from sqlalchemy import text

from .database import engine
from .genres import canonical_genre


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report without writing")
    args = ap.parse_args()

    with engine.connect() as con:
        rows = con.execute(text(
            "SELECT genre, COUNT(*) c FROM album"
            " WHERE genre IS NOT NULL AND genre <> ''"
            " GROUP BY genre ORDER BY c DESC"
        )).fetchall()

        changes = [(g, canonical_genre(g), c) for g, c in rows]
        changes = [(before, after, c) for before, after, c in changes if before != after]

        if not changes:
            print("[normalize_genres] nothing to do — every genre is already canonical")
            return

        total = sum(c for _, _, c in changes)
        print(f"[normalize_genres] {len(changes)} spellings covering {total} albums:")
        for before, after, c in changes:
            print(f"  {c:5d}  {before!r} -> {after!r}")

        if args.dry_run:
            print("[normalize_genres] dry run — nothing written")
            return

        for before, after, _ in changes:
            con.execute(
                text("UPDATE album SET genre = :after WHERE genre = :before"),
                {"after": after, "before": before},
            )
        con.commit()
        print(f"[normalize_genres] updated {total} albums")


if __name__ == "__main__":
    main()
