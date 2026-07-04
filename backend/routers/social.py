from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select, func
from ..database import get_session
from ..models import Album, Friendship, Like, PressUser

router = APIRouter(prefix="/social", tags=["social"])


@router.get("/feed")
def get_feed(user_id: int = Query(...), session: Session = Depends(get_session)):
    friendships = session.exec(
        select(Friendship).where(
            (Friendship.user_id_a == user_id) | (Friendship.user_id_b == user_id)
        )
    ).all()
    friend_ids = [
        f.user_id_b if f.user_id_a == user_id else f.user_id_a
        for f in friendships
    ]
    if not friend_ids:
        return []

    friends = {u.id: u for u in [session.get(PressUser, fid) for fid in friend_ids] if u}

    albums = session.exec(
        select(Album)
        .where(Album.user_id.in_(friend_ids))
        .where(Album.status == "rated")
        .where(Album.score.is_not(None))
        .order_by(Album.date_rated.desc(), Album.id.desc())
        .limit(100)
    ).all()

    album_ids = [a.id for a in albums]

    # Like counts per album
    like_counts: dict[int, int] = {}
    liked_by_me: set[int] = set()
    if album_ids:
        counts = session.exec(
            select(Like.album_id, func.count(Like.id).label("cnt"))
            .where(Like.album_id.in_(album_ids))
            .group_by(Like.album_id)
        ).all()
        like_counts = {row[0]: row[1] for row in counts}

        my_likes = session.exec(
            select(Like.album_id)
            .where(Like.album_id.in_(album_ids))
            .where(Like.user_id == user_id)
        ).all()
        liked_by_me = set(my_likes)

    items = []
    for album in albums:
        friend = friends.get(album.user_id)
        if not friend:
            continue
        items.append({
            "friend": {"id": friend.id, "name": friend.name, "avatar_url": friend.avatar_url},
            "album_id": album.id,
            "album_name": album.album_name,
            "artist": album.artist,
            "album_art_url": album.album_art_url,
            "score": album.score,
            "date_rated": album.date_rated.isoformat() if album.date_rated else None,
            "like_count": like_counts.get(album.id, 0),
            "liked_by_me": album.id in liked_by_me,
        })

    return items


@router.post("/like")
def toggle_like(
    user_id: int = Query(...),
    album_id: int = Query(...),
    session: Session = Depends(get_session),
):
    existing = session.exec(
        select(Like).where(Like.user_id == user_id, Like.album_id == album_id)
    ).first()
    if existing:
        session.delete(existing)
        session.commit()
        return {"liked": False}
    session.add(Like(user_id=user_id, album_id=album_id))
    session.commit()
    return {"liked": True}
