"""Where a like on someone's rating lives, read in one place.

A rating that carries a review is also a post in the record's thread, and a
like on it is that post's up-vote (`postlike`), the same one the thread's arrow
casts; `POST /social/like` writes it there. A bare rating, or a review whose
post doesn't exist, is liked with the old per-copy `like` row. Every surface
that shows a like reads it through `like_states`, so a like given on one screen
or platform reads back the same on every other. Until November 2026 the feed
read the post while `/social/top-reviews` (For You on both apps) and
`/social/reviews` (web's Reviews tab) counted only `like` rows: a review liked
anywhere read as unliked there, and a second tap from there took the like back.
"""
from sqlalchemy import func, text as _sql
from sqlmodel import Session, select

from .models import Comment, Like


def review_posts(session: Session, albums: list, user_id: int) -> dict[int, dict]:
    """Each album copy's review post in its record's thread, by album id: its id,
    up-votes, replies, and whether `user_id` voted it up."""
    albums = [a for a in albums if a.review and a.subject_key]
    if not albums:
        return {}
    rows = session.execute(_sql("""
        SELECT p.id, p.user_id, t.subject_key, p.like_count, p.reply_count,
               EXISTS (SELECT 1 FROM postlike v WHERE v.post_id = p.id AND v.user_id = :me AND v.value = 1)
        FROM post p JOIN thread t ON t.id = p.thread_id
        WHERE t.subject_type = 'album' AND p.kind = 'review' AND p.deleted_at IS NULL
          AND p.user_id = ANY(:users) AND t.subject_key = ANY(:keys)"""),
        {"me": user_id, "users": list({a.user_id for a in albums}),
         "keys": list({a.subject_key for a in albums})}).all()
    by_owner = {(r[1], r[2]): {"id": r[0], "likes": r[3] or 0, "replies": r[4] or 0, "mine": bool(r[5])}
                for r in rows}
    return {a.id: by_owner[(a.user_id, a.subject_key)] for a in albums if (a.user_id, a.subject_key) in by_owner}


def like_states(session: Session, albums: list, user_id: int) -> dict[int, dict]:
    """`{album_id: {like_count, liked_by_me, comment_count, post_id}}` for every
    album given: the review post's up-votes and replies when there is one,
    else the copy's `like` and `comment` rows."""
    ids = [a.id for a in albums]
    if not ids:
        return {}
    likes = dict(session.exec(
        select(Like.album_id, func.count(Like.id)).where(Like.album_id.in_(ids)).group_by(Like.album_id)
    ).all())
    comments = dict(session.exec(
        select(Comment.album_id, func.count(Comment.id)).where(Comment.album_id.in_(ids)).group_by(Comment.album_id)
    ).all())
    mine = set(session.exec(
        select(Like.album_id).where(Like.album_id.in_(ids)).where(Like.user_id == user_id)
    ).all())
    posts = review_posts(session, albums, user_id)
    out: dict[int, dict] = {}
    for a in albums:
        post = posts.get(a.id)
        if post:
            out[a.id] = {"like_count": post["likes"], "liked_by_me": post["mine"],
                         "comment_count": post["replies"], "post_id": post["id"]}
        else:
            out[a.id] = {"like_count": likes.get(a.id, 0), "liked_by_me": a.id in mine,
                         "comment_count": comments.get(a.id, 0), "post_id": None}
    return out
