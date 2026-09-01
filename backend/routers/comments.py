from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func

from ..database import get_session
from ..deps import current_user, authorize_view
from ..models import Album, Comment, PressUser
from ..threads import remove_comment_post, sync_comment_post

router = APIRouter(tags=["comments"])

MAX_COMMENT_LEN = 1000


def _serialize(comment: Comment, author: PressUser | None, viewer_id: int, album_owner_id: int) -> dict:
    return {
        "id": comment.id,
        "album_id": comment.album_id,
        "body": comment.body,
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
        "author": {
            "id": author.id if author else comment.user_id,
            "name": author.name if author else "Unknown",
            "avatar_url": author.avatar_url if author else None,
        },
        # The comment's author or the album's owner may remove it.
        "can_delete": viewer_id == comment.user_id or viewer_id == album_owner_id,
    }


@router.get("/albums/{album_id}/comments")
def list_comments(
    album_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    # You can read comments on an album you can view: your own or a friend's.
    authorize_view(user, album.user_id, session)

    comments = session.exec(
        select(Comment).where(Comment.album_id == album_id).order_by(Comment.created_at.asc())
    ).all()
    author_ids = {c.user_id for c in comments}
    authors = {
        u.id: u
        for u in (session.get(PressUser, aid) for aid in author_ids)
        if u
    }
    return [_serialize(c, authors.get(c.user_id), user.id, album.user_id) for c in comments]


@router.post("/albums/{album_id}/comments")
def create_comment(
    album_id: int,
    data: dict,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    authorize_view(user, album.user_id, session)

    body = (data.get("body") or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    if len(body) > MAX_COMMENT_LEN:
        body = body[:MAX_COMMENT_LEN]

    comment = Comment(album_id=album_id, user_id=user.id, body=body)
    session.add(comment)
    session.commit()
    session.refresh(comment)
    # A comment on someone's rating is a reply to what they wrote about the
    # record, so it belongs in the record's thread too. Conditional — see
    # threads.sync_comment_post for when it does not mirror.
    sync_comment_post(session, comment, album)
    return _serialize(comment, user, user.id, album.user_id)


@router.delete("/comments/{comment_id}")
def delete_comment(
    comment_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    comment = session.get(Comment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    album = session.get(Album, comment.album_id)
    album_owner_id = album.user_id if album else None
    # Only the comment's author or the album's owner can delete it.
    if user.id != comment.user_id and user.id != album_owner_id:
        raise HTTPException(status_code=403, detail="Not allowed to delete this comment")
    remove_comment_post(session, comment)
    session.delete(comment)
    session.commit()
    return {"ok": True}
