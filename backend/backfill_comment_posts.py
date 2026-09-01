"""One-off: mirror comments written before threads existed into their threads.

A comment on a friend's rating is a reply to what they wrote about the record.
Once reviews became thread posts, the replies to them stayed behind on the album
page, so the same exchange read as a conversation in one place and a monologue
in the other.

Runs through `threads.sync_comment_post`, so the guards are the same ones new
comments go through: there has to be a review post to answer, the commenter has
to have rated the record, and a comment on your own album is skipped. Comments
that fail those stay where they are.

Idempotent — a comment already carrying `post_id` is skipped.

    python -m backend.backfill_comment_posts [--dry-run]

**This publishes text that was written friends-only.** That was a deliberate
call (see PLAN_discussions.md §16); it is not a decision this script should be
re-run to make casually.
"""

from __future__ import annotations

import sys

from sqlalchemy import text
from sqlmodel import Session

from .database import engine
from .models import Album, Comment
from .threads import sync_comment_post


def main(dry_run: bool = False) -> int:
    with Session(engine) as session:
        ids = [r[0] for r in session.execute(text(
            "SELECT id FROM comment WHERE post_id IS NULL ORDER BY created_at, id"
        )).fetchall()]
        print(f"{len(ids)} comments not yet mirrored")

        moved = 0
        for cid in ids:
            comment = session.get(Comment, cid)
            if not comment:
                continue
            album = session.get(Album, comment.album_id)
            if not album:
                continue
            if dry_run:
                print(f"  would try comment {cid} on album {album.id} ({album.album_name})")
                continue
            sync_comment_post(session, comment, album)
            session.refresh(comment)
            if comment.post_id:
                moved += 1

        if not dry_run:
            print(f"done. {moved} mirrored, {len(ids) - moved} left as comments "
                  f"(no review to answer, or the commenter had not rated it)")
        return 0


if __name__ == "__main__":
    sys.exit(main(dry_run="--dry-run" in sys.argv))
