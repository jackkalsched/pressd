"""One-off: mirror every review written before threads existed into its thread.

Reviews were the conversation before this feature had a name. On a record two
people have both reviewed, the discussion has already started, and an Album
thoughts card reading "Start the conversation" is simply wrong.

Idempotent — `sync_review_post` upserts, so a second run reports the same count
and changes nothing. Safe to re-run after importing older data.

    python -m backend.backfill_review_posts [--dry-run]

See PLAN_discussions.md §3.1 and backend/threads.py.
"""

from __future__ import annotations

import sys

from sqlalchemy import text
from sqlmodel import Session

from .database import engine
from .models import Album
from .threads import sync_review_post


def main(dry_run: bool = False) -> int:
    with Session(engine) as session:
        ids = [r[0] for r in session.execute(text(
            "SELECT id FROM album WHERE review IS NOT NULL AND TRIM(review) <> ''"
            " AND subject_key IS NOT NULL ORDER BY review_at NULLS LAST, id"
        )).fetchall()]
        print(f"{len(ids)} reviews to mirror")
        if dry_run:
            for aid in ids[:10]:
                a = session.get(Album, aid)
                print(f"  would mirror album {aid} ({a.album_name}) -> {a.subject_key}")
            if len(ids) > 10:
                print(f"  ... and {len(ids) - 10} more")
            return 0

        done = 0
        for aid in ids:
            album = session.get(Album, aid)
            if album:
                sync_review_post(session, album)
                done += 1
                if done % 20 == 0:
                    print(f"  {done}/{len(ids)}")

        posts = session.execute(text(
            "SELECT COUNT(*) FROM post WHERE kind = 'review' AND deleted_at IS NULL")).scalar()
        threads = session.execute(text("SELECT COUNT(*) FROM thread")).scalar()
        print(f"done. {posts} review posts across {threads} threads")
        return 0


if __name__ == "__main__":
    sys.exit(main(dry_run="--dry-run" in sys.argv))
