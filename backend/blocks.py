"""Blocking (Jack, November 2026): when one person blocks another, **both** stop
seeing each other's reviews and social activity, and neither can friend or
recommend a record to the other. Nothing is deleted from the record —
everyone's ratings still count in charts, averages and the Pressd scores; only
what one of the pair is *shown* of the other changes.

Where it applies (each surface checks here, so the rule has one definition):
the friends feed and friends' reviews, the userbase reviews on For You, a
record's thread (posts and replies) and the discussions feed, people search and
contact matching, the people sheet after a rating, a profile's friends list,
friend requests and recommendations, and reply notifications. Blocking also
ends any friendship or request between the two.
"""
from sqlalchemy import text
from sqlmodel import Session, select

# For raw SQL over posts: drop rows whose author is blocked either way with the
# caller. Bind `blk_me`; format `col` with the author column.
BLOCKED_SQL = (
    " AND NOT EXISTS (SELECT 1 FROM block b WHERE"
    " (b.blocker_id = :blk_me AND b.blocked_id = {col})"
    " OR (b.blocker_id = {col} AND b.blocked_id = :blk_me))"
)


def blocked_ids(session: Session, user_id: int) -> set[int]:
    """Everyone the user has blocked or been blocked by."""
    from .models import Block

    rows = session.exec(
        select(Block.blocker_id, Block.blocked_id).where(
            (Block.blocker_id == user_id) | (Block.blocked_id == user_id)
        )
    ).all()
    return {b if a == user_id else a for a, b in rows}


def is_blocked(session: Session, a: int, b: int) -> bool:
    """Whether either of the two has blocked the other."""
    return session.execute(
        text(
            "SELECT 1 FROM block WHERE (blocker_id = :a AND blocked_id = :b)"
            " OR (blocker_id = :b AND blocked_id = :a) LIMIT 1"
        ),
        {"a": a, "b": b},
    ).first() is not None
