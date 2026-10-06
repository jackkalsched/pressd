"""One-off: point stored Internet Archive cover URLs at the 500px thumbnail
instead of the uploaded original.

Until October 2026 the cover backfill (`routers/util.py`) asked the Cover Art
Archive for a release's `front` image and stored the address it redirected to —
the full-size original on one Archive storage machine. 643 of 1,006 albums held
one: measured at 0.3–11 MB and 2–10 s each, for an image drawn at 58–184 px.
The Archive already serves `_thumb250/500/1200` copies beside every original, on
the same machine, so the fix is a suffix: `…-<id>.jpg` → `…-<id>_thumb500.jpg`.
On 20 sampled albums the thumbnail loaded wherever the original did, in ~1.2 s
against several seconds, and at ~55–90 KB.

The thumbnail stays on the stored machine rather than moving to the stable
coverartarchive.org address: that address costs a redirect (~2.1 s against
~1.2 s), and the apps already fall back to it when a machine stops answering
(`shared/src/covers.ts`, `coverFallbacks`).

Touches only URLs that are an original — a stored thumbnail is left alone, so
running it twice changes nothing. Dry run by default:

    python -m backend.thumbnail_cover_urls            # report only
    python -m backend.thumbnail_cover_urls --apply    # write

Not touched: `artistmeta.albums_json`, whose discography covers were always the
stable `coverartarchive.org/release-group/<id>/front-250` form, and `cachedfeed`,
which the worker rebuilds every 6h.
"""
from __future__ import annotations

import sys

from sqlalchemy import text

from .database import engine

# A stored original: …archive.org/<n>/items/mbid-<release>/mbid-<release>-<image>.<ext>
# Group 1 is everything up to the extension; the thumbnail is always a .jpg.
ORIGINAL = (
    r"(https://[a-z0-9.-]+\.archive\.org/[0-9]+/items/mbid-[0-9a-f-]{36}"
    r"/mbid-[0-9a-f-]{36}-[0-9]+)\.(jpg|jpeg|png)"
)

# Each holds one URL per row, copied from the album when the row was made.
TARGETS = [
    ("album", "album_art_url"),
    ("albumprediction", "album_art_url"),
    ("thread", "art_url"),
]


def main(apply: bool) -> None:
    with engine.begin() as conn:
        for table, column in TARGETS:
            match = f"^{ORIGINAL}$"
            new = rf"regexp_replace({column}, '{match}', '\1_thumb500.jpg')"
            where = f"{column} ~ '{match}'"
            n = conn.execute(text(f"SELECT COUNT(*) FROM {table} WHERE {where}")).scalar()
            example = conn.execute(
                text(f"SELECT {column}, {new} FROM {table} WHERE {where} LIMIT 1")
            ).first()
            print(f"{table}.{column}: {n} row(s) to rewrite")
            if example:
                print(f"    {example[0]}\n -> {example[1]}")
            if apply and n:
                done = conn.execute(text(f"UPDATE {table} SET {column} = {new} WHERE {where}")).rowcount
                print(f"    rewrote {done}")
        if not apply:
            print("\nDry run — nothing written. Re-run with --apply to write.")


if __name__ == "__main__":
    main(apply="--apply" in sys.argv[1:])
