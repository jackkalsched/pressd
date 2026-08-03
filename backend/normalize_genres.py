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
from .genres import canonical_genre, canonical_subgenre

SUBGENRE_COLUMNS = ("sub_genre1", "sub_genre2", "sub_genre3")


def _plan(con, column: str, fn) -> list[tuple[str, str, int]]:
    """Spellings in `column` that `fn` would rewrite, with how many rows each
    covers. Counted per column, so one album can appear under several."""
    rows = con.execute(text(
        f"SELECT {column}, COUNT(*) c FROM album"
        f" WHERE {column} IS NOT NULL AND {column} <> ''"
        f" GROUP BY {column} ORDER BY c DESC"
    )).fetchall()
    return [(before, fn(before), c) for before, c in rows if fn(before) != before]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report without writing")
    args = ap.parse_args()

    with engine.connect() as con:
        plans = [("genre", _plan(con, "genre", canonical_genre))]
        for col in SUBGENRE_COLUMNS:
            plans.append((col, _plan(con, col, canonical_subgenre)))

        if not any(changes for _, changes in plans):
            print("[normalize_genres] nothing to do — every value is already canonical")
            return

        for column, changes in plans:
            if not changes:
                continue
            total = sum(c for _, _, c in changes)
            print(f"[normalize_genres] {column}: {len(changes)} spellings, {total} rows")
            for before, after, c in changes:
                print(f"    {c:5d}  {before!r} -> {after!r}")

        if args.dry_run:
            print("[normalize_genres] dry run — nothing written")
            return

        written = 0
        for column, changes in plans:
            for before, after, c in changes:
                con.execute(
                    text(f"UPDATE album SET {column} = :after WHERE {column} = :before"),
                    {"after": after, "before": before},
                )
                written += c
        con.commit()
        print(f"[normalize_genres] updated {written} values")


if __name__ == "__main__":
    main()
