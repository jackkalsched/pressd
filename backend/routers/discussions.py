"""Discussion threads on records, artists and tracks (PLAN_discussions.md §5).

Userbase-wide, unlike everything else social here: the friends-scoped surfaces
exist so you can see what people you know are listening to, and this exists so
strangers who love the same record can find each other. Nothing in this module
may ever be reachable without a token — `routers/public.py` stays the only
unauthenticated surface.

Two rules shape every endpoint:

  A client never decides a subject key. Callers pass an artist and an album
  name, or a track id, and the server runs trackkeys.subject_key_album over
  them. Letting the client send the key means one normalisation drift silently
  forks a room, and the client is the half of the system that is hardest to
  update.

  Reading and posting carry the same permission (`deps.thread_access`). See
  §4.1 — the gate is what makes the room worth entering.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field as PydField
from sqlalchemy import text as _sql
from sqlmodel import Session

from ..database import get_session
from ..deps import authorize_thread, current_user, thread_access
from ..models import Post, PostLike, PostReport, PressUser, Thread
from ..threads import display_for, get_or_create_thread
from ..trackkeys import subject_key_album, subject_key_artist
from ..threads import SPOILER_FLAGS_TO_BLUR

router = APIRouter(tags=["discussions"])

MAX_POST_LEN = 4000
PAGE_SIZE = 25

# Flags needed before a post is blurred / hidden for everyone. Low enough to
# work at this userbase's size, and both are per-person by unique constraint so
# one determined tapper cannot reach them alone (§4.3).
REPORTS_TO_HIDE = 5

SUBJECT_TYPES = ("album", "artist", "track")


# ── Subject resolution ───────────────────────────────────────────────────────

class SubjectRef(BaseModel):
    subject_type: str
    artist: str | None = None
    album: str | None = None
    track_id: int | None = None


def _resolve_key(ref: SubjectRef) -> str:
    """The server's word on what room this is. Never the client's."""
    if ref.subject_type == "album":
        if not ref.artist or not ref.album:
            raise HTTPException(400, "album threads need artist and album")
        return subject_key_album(ref.artist, ref.album)
    if ref.subject_type == "artist":
        if not ref.artist:
            raise HTTPException(400, "artist threads need artist")
        return subject_key_artist(ref.artist)
    if ref.subject_type == "track":
        if ref.track_id is None:
            raise HTTPException(400, "track threads need track_id")
        return str(ref.track_id)
    raise HTTPException(400, f"unknown subject_type {ref.subject_type!r}")


# ── Author scores (§4.2) ─────────────────────────────────────────────────────

def _author_scores(session: Session, thread: Thread, user_ids: list[int]) -> dict[int, float]:
    """Each author's current score for this subject.

    Live rather than snapshotted onto the post: a user can edit any song score
    or factor afterwards and the album recomputes, so a frozen number would sit
    next to a standing opinion and contradict it.
    """
    if not user_ids:
        return {}
    ids = tuple(user_ids)
    if thread.subject_type == "album":
        sql = ("SELECT user_id, score FROM album WHERE subject_key = :k"
               " AND status = 'rated' AND score IS NOT NULL AND user_id IN :ids")
        params = {"k": thread.subject_key, "ids": ids}
    elif thread.subject_type == "track":
        sql = ("SELECT a.user_id, s.score FROM song s JOIN album a ON a.id = s.album_id"
               " WHERE s.track_id = :k AND s.score IS NOT NULL AND a.user_id IN :ids")
        params = {"k": thread.subject_key, "ids": ids}
    else:
        sql = ("SELECT user_id, AVG(score) FROM album WHERE subject_key LIKE :p"
               " AND status = 'rated' AND score IS NOT NULL AND user_id IN :ids"
               " GROUP BY user_id")
        params = {"p": f"{thread.subject_key}||%", "ids": ids}
    rows = session.execute(_sql(sql), params).fetchall()
    return {r[0]: round(float(r[1]), 2) for r in rows if r[1] is not None}


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/threads/resolve")
def resolve_thread(
    subject_type: str = Query(...),
    artist: str | None = None,
    album: str | None = None,
    track_id: int | None = None,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Thread metadata plus whether this caller is allowed in.

    Deliberately does not 403 on a locked subject: the album page has to draw
    the lock and say what would unlock it, which it cannot do from an error.
    """
    if subject_type not in SUBJECT_TYPES:
        raise HTTPException(400, f"unknown subject_type {subject_type!r}")
    key = _resolve_key(SubjectRef(subject_type=subject_type, artist=artist,
                                  album=album, track_id=track_id))
    allowed, reason = thread_access(session, user.id, subject_type, key)
    row = session.execute(_sql(
        "SELECT id, title, subtitle, art_url, post_count, last_post_at FROM thread"
        " WHERE subject_type = :s AND subject_key = :k"), {"s": subject_type, "k": key}).first()
    title, subtitle, art = display_for(session, subject_type, key)

    # How many reviews stand, and how many other people have rated the record.
    # Both are what the album page needs to decide whether writing is joining a
    # conversation or starting one, and it should not have to pull the whole
    # thread to find out. Excludes the caller: "alongside N pressers" counts the
    # company you would be keeping, not you.
    review_count = rater_count = participant_count = 0
    if subject_type == "album":
        review_count, rater_count, participant_count = session.execute(_sql("""
            SELECT
              (SELECT COUNT(*) FROM post p JOIN thread t ON t.id = p.thread_id
                WHERE t.subject_type = 'album' AND t.subject_key = :k
                  AND p.kind = 'review' AND p.deleted_at IS NULL),
              (SELECT COUNT(DISTINCT a.user_id) FROM album a
                WHERE a.subject_key = :k AND a.status = 'rated' AND a.user_id <> :me),
              -- People, not posts: "N pressers weighed in" counts voices in the
              -- room, so someone who wrote a review and three replies is one.
              -- Includes the caller, who is one of the voices.
              (SELECT COUNT(DISTINCT p.user_id) FROM post p JOIN thread t ON t.id = p.thread_id
                WHERE t.subject_type = 'album' AND t.subject_key = :k
                  AND p.kind <> 'system' AND p.deleted_at IS NULL AND p.user_id IS NOT NULL)
        """), {"k": key, "me": user.id}).first()
    return {
        "subject_type": subject_type,
        "subject_key": key,
        "thread_id": row[0] if row else None,
        "title": row[1] if row else title,
        "subtitle": row[2] if row else subtitle,
        "art_url": row[3] if row else art,
        "post_count": row[4] if row else 0,
        "review_count": review_count,
        "rater_count": rater_count,
        "participant_count": participant_count,
        "last_post_at": row[5].isoformat() if row and row[5] else None,
        "can_read": allowed,
        "can_post": allowed,
        "locked_reason": reason,
    }


def _serialize(row, viewer_id: int, scores: dict[int, float], liked: set[int]) -> dict:
    (pid, uid, parent_id, body, kind, is_spoiler, created_at, edited_at, deleted_at,
     like_count, reply_count, name, avatar, spoiler_flags) = row
    removed = deleted_at is not None
    return {
        "id": pid,
        "parent_id": parent_id,
        "kind": kind,
        "body": "" if removed else body,
        "deleted": removed,
        "is_spoiler": bool(is_spoiler) or (spoiler_flags or 0) >= SPOILER_FLAGS_TO_BLUR,
        "created_at": created_at.isoformat() if created_at else None,
        "edited_at": edited_at.isoformat() if edited_at else None,
        "like_count": like_count or 0,
        "reply_count": reply_count or 0,
        "liked_by_me": pid in liked,
        "author": None if uid is None else {
            "id": uid, "name": name or "Unknown", "avatar_url": avatar,
            "score": scores.get(uid),
        },
        "can_delete": uid is not None and uid == viewer_id,
        "can_edit": uid is not None and uid == viewer_id and not removed,
    }


@router.get("/threads/{thread_id}/posts")
def list_posts(
    thread_id: int,
    sort: str = Query("popular", pattern="^(newest|popular|all)$"),
    cursor: str | None = None,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    thread = session.get(Thread, thread_id)
    if not thread:
        raise HTTPException(404, "Thread not found")
    authorize_thread(session, user.id, thread.subject_type, thread.subject_key)

    # Popular is a 7-day window over likes and replies; All time is the same
    # ranking unwindowed, which the denormalised counters answer directly (§6).
    if sort == "newest":
        order = "p.created_at DESC, p.id DESC"
        rank = "0"
    elif sort == "all":
        order = "(p.like_count + p.reply_count) DESC, p.created_at DESC, p.id DESC"
        rank = "0"
    else:
        rank = ("(SELECT COUNT(*) FROM postlike pl WHERE pl.post_id = p.id"
                "   AND pl.created_at > NOW() - INTERVAL '7 days')"
                " + (SELECT COUNT(*) FROM post r WHERE r.parent_id = p.id"
                "   AND r.created_at > NOW() - INTERVAL '7 days')")
        order = f"{rank} DESC, p.created_at DESC, p.id DESC"

    # Keyset for newest, offset for the two ranked sorts: a rank is not
    # monotonic, so a cursor on it drifts between pages. These are top-of-thread
    # views that are rarely deep-paged, and correctness of page 1 matters more.
    where_extra, params = "", {"t": thread_id, "lim": PAGE_SIZE + 1}
    offset = 0
    if sort == "newest" and cursor:
        try:
            params["cid"] = int(cursor)
            where_extra = " AND p.id < :cid"
        except ValueError:
            raise HTTPException(400, "bad cursor")
    elif cursor:
        try:
            offset = max(0, int(cursor))
        except ValueError:
            raise HTTPException(400, "bad cursor")
    params["off"] = offset

    rows = session.execute(_sql(f"""
        SELECT p.id, p.user_id, p.parent_id, p.body, p.kind, p.is_spoiler,
               p.created_at, p.edited_at, p.deleted_at, p.like_count, p.reply_count,
               u.name, u.avatar_url,
               (SELECT COUNT(*) FROM postreport pr
                 WHERE pr.post_id = p.id AND pr.reason = 'spoiler') AS spoiler_flags
        FROM post p
        LEFT JOIN pressuser u ON u.id = p.user_id
        WHERE p.thread_id = :t AND p.parent_id IS NULL{where_extra}
          -- Hidden once enough distinct people report it, and always hidden
          -- from anyone who reported it themselves (§4.3).
          AND (SELECT COUNT(*) FROM postreport pr WHERE pr.post_id = p.id
                 AND pr.reason <> 'spoiler') < {REPORTS_TO_HIDE}
          AND NOT EXISTS (SELECT 1 FROM postreport pr WHERE pr.post_id = p.id
                            AND pr.user_id = :me AND pr.reason <> 'spoiler')
        ORDER BY p.kind = 'system' DESC, {order}
        LIMIT :lim OFFSET :off
    """), {**params, "me": user.id}).fetchall()

    more = len(rows) > PAGE_SIZE
    rows = rows[:PAGE_SIZE]
    ids = [r[0] for r in rows]
    authors = [r[1] for r in rows if r[1] is not None]
    scores = _author_scores(session, thread, authors)
    liked: set[int] = set()
    if ids:
        liked = {r[0] for r in session.execute(_sql(
            "SELECT post_id FROM postlike WHERE user_id = :u AND post_id IN :ids"),
            {"u": user.id, "ids": tuple(ids)}).fetchall()}

    next_cursor = None
    if more:
        next_cursor = str(rows[-1][0]) if sort == "newest" else str(offset + PAGE_SIZE)
    return {
        "thread_id": thread_id,
        "sort": sort,
        "posts": [_serialize(r, user.id, scores, liked) for r in rows],
        "next_cursor": next_cursor,
    }


class NewPost(BaseModel):
    subject_type: str
    artist: str | None = None
    album: str | None = None
    track_id: int | None = None
    body: str = PydField(min_length=1, max_length=MAX_POST_LEN)
    is_spoiler: bool = False


@router.post("/threads/posts")
def create_post(
    payload: NewPost,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    key = _resolve_key(SubjectRef(**payload.model_dump(exclude={"body", "is_spoiler"})))
    authorize_thread(session, user.id, payload.subject_type, key)
    thread = get_or_create_thread(session, payload.subject_type, key)
    post = Post(thread_id=thread.id, user_id=user.id,
                body=payload.body.strip(), is_spoiler=payload.is_spoiler)
    session.add(post)
    thread.post_count = (thread.post_count or 0) + 1
    thread.last_post_at = datetime.utcnow()
    session.add(thread)
    session.commit()
    session.refresh(post)
    return {"id": post.id, "thread_id": thread.id}


class NewReply(BaseModel):
    body: str = PydField(min_length=1, max_length=MAX_POST_LEN)


@router.post("/posts/{post_id}/replies")
def create_reply(
    post_id: int,
    payload: NewReply,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    parent = session.get(Post, post_id)
    if not parent or parent.deleted_at:
        raise HTTPException(404, "Post not found")
    if parent.kind == "system":
        raise HTTPException(400, "Cannot reply to a Press'd post")
    thread = session.get(Thread, parent.thread_id)
    authorize_thread(session, user.id, thread.subject_type, thread.subject_key)

    # One level, always: a reply to a reply attaches to the same top-level post.
    # Arbitrary nesting is unreadable at phone width and has no design (§3).
    root_id = parent.parent_id or parent.id
    reply = Post(thread_id=thread.id, user_id=user.id, parent_id=root_id,
                 body=payload.body.strip())
    session.add(reply)
    root = session.get(Post, root_id)
    root.reply_count = (root.reply_count or 0) + 1
    thread.post_count = (thread.post_count or 0) + 1
    thread.last_post_at = datetime.utcnow()
    session.add_all([root, thread])
    session.commit()
    session.refresh(reply)
    return {"id": reply.id, "parent_id": root_id}


@router.get("/posts/{post_id}/replies")
def list_replies(
    post_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    parent = session.get(Post, post_id)
    if not parent:
        raise HTTPException(404, "Post not found")
    thread = session.get(Thread, parent.thread_id)
    authorize_thread(session, user.id, thread.subject_type, thread.subject_key)
    rows = session.execute(_sql("""
        SELECT p.id, p.user_id, p.parent_id, p.body, p.kind, p.is_spoiler,
               p.created_at, p.edited_at, p.deleted_at, p.like_count, p.reply_count,
               u.name, u.avatar_url,
               (SELECT COUNT(*) FROM postreport pr WHERE pr.post_id = p.id
                  AND pr.reason = 'spoiler') AS spoiler_flags
        FROM post p LEFT JOIN pressuser u ON u.id = p.user_id
        WHERE p.parent_id = :p ORDER BY p.created_at ASC
    """), {"p": post_id}).fetchall()
    authors = [r[1] for r in rows if r[1] is not None]
    scores = _author_scores(session, thread, authors)
    liked: set[int] = set()
    if rows:
        liked = {r[0] for r in session.execute(_sql(
            "SELECT post_id FROM postlike WHERE user_id = :u AND post_id IN :ids"),
            {"u": user.id, "ids": tuple(r[0] for r in rows)}).fetchall()}
    return [_serialize(r, user.id, scores, liked) for r in rows]


class EditPost(BaseModel):
    body: str = PydField(min_length=1, max_length=MAX_POST_LEN)


@router.patch("/posts/{post_id}")
def edit_post(
    post_id: int,
    payload: EditPost,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    post = session.get(Post, post_id)
    if not post or post.deleted_at:
        raise HTTPException(404, "Post not found")
    if post.user_id != user.id:
        raise HTTPException(403, "Not your post")
    post.body = payload.body.strip()
    post.edited_at = datetime.utcnow()
    session.add(post)
    session.commit()
    return {"ok": True}


@router.delete("/posts/{post_id}")
def delete_post(
    post_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Soft, because a removed parent still has to anchor its replies (§3)."""
    post = session.get(Post, post_id)
    if not post:
        raise HTTPException(404, "Post not found")
    if post.user_id != user.id:
        raise HTTPException(403, "Not your post")
    if post.deleted_at:
        return {"ok": True}
    post.deleted_at = datetime.utcnow()
    session.add(post)
    thread = session.get(Thread, post.thread_id)
    if thread:
        thread.post_count = max(0, (thread.post_count or 1) - 1)
        session.add(thread)
    session.commit()
    return {"ok": True}


@router.post("/posts/{post_id}/like")
def like_post(
    post_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    post = session.get(Post, post_id)
    if not post or post.deleted_at:
        raise HTTPException(404, "Post not found")
    if post.kind == "system":
        raise HTTPException(400, "Cannot like a Press'd post")
    thread = session.get(Thread, post.thread_id)
    authorize_thread(session, user.id, thread.subject_type, thread.subject_key)
    existing = session.execute(_sql(
        "SELECT 1 FROM postlike WHERE user_id = :u AND post_id = :p"),
        {"u": user.id, "p": post_id}).first()
    if existing:
        return {"liked": True, "like_count": post.like_count}
    session.add(PostLike(user_id=user.id, post_id=post_id))
    post.like_count = (post.like_count or 0) + 1
    session.add(post)
    session.commit()
    return {"liked": True, "like_count": post.like_count}


@router.delete("/posts/{post_id}/like")
def unlike_post(
    post_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    post = session.get(Post, post_id)
    if not post:
        raise HTTPException(404, "Post not found")
    removed = session.execute(_sql(
        "DELETE FROM postlike WHERE user_id = :u AND post_id = :p"),
        {"u": user.id, "p": post_id}).rowcount
    if removed:
        post.like_count = max(0, (post.like_count or 1) - 1)
        session.add(post)
    session.commit()
    return {"liked": False, "like_count": post.like_count}


class Report(BaseModel):
    reason: str = PydField(pattern="^(abuse|off_subject|spoiler)$")


@router.post("/posts/{post_id}/report")
def report_post(
    post_id: int,
    payload: Report,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Reporting hides the post from the reporter at once; enough distinct
    reporters hide it from everyone pending review. Unique per (user, post), so
    repeated taps cannot manufacture the count (§4.3).

    There is no admin console yet — resolving one means running SQL by hand.
    Acceptable at this size, a liability at scale, and noted as such in the plan.
    """
    post = session.get(Post, post_id)
    if not post or post.deleted_at:
        raise HTTPException(404, "Post not found")
    if post.user_id == user.id:
        raise HTTPException(400, "Cannot report your own post")
    existing = session.execute(_sql(
        "SELECT 1 FROM postreport WHERE user_id = :u AND post_id = :p"),
        {"u": user.id, "p": post_id}).first()
    if not existing:
        session.add(PostReport(post_id=post_id, user_id=user.id, reason=payload.reason))
        session.commit()
    return {"ok": True}


@router.post("/posts/{post_id}/spoiler")
def flag_spoiler(
    post_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """A spoiler flag is a report with reason='spoiler': same one-per-person
    constraint, different threshold, and it blurs rather than hides. An author
    can mark their own, which is the one case a self-report makes sense."""
    post = session.get(Post, post_id)
    if not post or post.deleted_at:
        raise HTTPException(404, "Post not found")
    if post.user_id == user.id:
        post.is_spoiler = True
        session.add(post)
        session.commit()
        return {"ok": True, "blurred": True}
    existing = session.execute(_sql(
        "SELECT 1 FROM postreport WHERE user_id = :u AND post_id = :p"),
        {"u": user.id, "p": post_id}).first()
    if not existing:
        session.add(PostReport(post_id=post_id, user_id=user.id, reason="spoiler"))
        session.commit()
    flags = session.execute(_sql(
        "SELECT COUNT(*) FROM postreport WHERE post_id = :p AND reason = 'spoiler'"),
        {"p": post_id}).scalar()
    return {"ok": True, "blurred": flags >= SPOILER_FLAGS_TO_BLUR}
