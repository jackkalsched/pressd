from datetime import datetime, date
from fastapi import APIRouter, Depends, Query
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select, func
from ..database import get_session
from ..deps import current_user
from ..models import Album, Comment, Friendship, Like, PressUser, Song

router = APIRouter(prefix="/social", tags=["social"])

EXCERPT_LEN = 280


def _excerpt(text: str) -> str:
    """First ~280 chars of a review body for feed/list cards, cut on a word."""
    text = " ".join(text.split())  # collapse whitespace for the preview
    if len(text) <= EXCERPT_LEN:
        return text
    cut = text[:EXCERPT_LEN].rsplit(" ", 1)[0]
    return cut + "…"


@router.get("/feed")
def get_feed(
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Merged activity stream: friends' ratings + recommendations sent to you.

    Each item carries a `type` discriminator ("rating" | "recommendation") and
    the whole list is sorted newest-first by the event's timestamp.
    """
    user_id = user.id
    friendships = session.exec(
        select(Friendship).where(
            (Friendship.user_id_a == user_id) | (Friendship.user_id_b == user_id),
            Friendship.status == "accepted",
        )
    ).all()
    friend_ids = [
        f.user_id_b if f.user_id_a == user_id else f.user_id_a
        for f in friendships
    ]

    items: list[dict] = []

    # ── Rating events: friends' recently rated albums ──────────────────────
    if friend_ids:
        friends = {u.id: u for u in [session.get(PressUser, fid) for fid in friend_ids] if u}
        rating_albums = session.exec(
            select(Album)
            .where(Album.user_id.in_(friend_ids))
            .where(Album.status == "rated")
            .where(Album.score.is_not(None))
            .order_by(Album.date_rated.desc(), Album.id.desc())
            .limit(100)
        ).all()

        album_ids = [a.id for a in rating_albums]
        like_counts: dict[int, int] = {}
        comment_counts: dict[int, int] = {}
        liked_by_me: set[int] = set()
        if album_ids:
            like_counts = {
                row[0]: row[1]
                for row in session.exec(
                    select(Like.album_id, func.count(Like.id))
                    .where(Like.album_id.in_(album_ids))
                    .group_by(Like.album_id)
                ).all()
            }
            comment_counts = {
                row[0]: row[1]
                for row in session.exec(
                    select(Comment.album_id, func.count(Comment.id))
                    .where(Comment.album_id.in_(album_ids))
                    .group_by(Comment.album_id)
                ).all()
            }
            liked_by_me = set(session.exec(
                select(Like.album_id)
                .where(Like.album_id.in_(album_ids))
                .where(Like.user_id == user_id)
            ).all())

        for album in rating_albums:
            friend = friends.get(album.user_id)
            if not friend:
                continue
            base = {
                "friend": {"id": friend.id, "name": friend.name, "avatar_url": friend.avatar_url},
                "album_id": album.id,
                "album_name": album.album_name,
                "artist": album.artist,
                "album_art_url": album.album_art_url,
                "score": album.score,
                "like_count": like_counts.get(album.id, 0),
                "liked_by_me": album.id in liked_by_me,
                "comment_count": comment_counts.get(album.id, 0),
            }
            if album.review and album.review_at:
                # A rating that carries a review is a higher-signal event.
                items.append({
                    **base,
                    "type": "review",
                    "review_excerpt": _excerpt(album.review),
                    "review_at": album.review_at.isoformat(),
                    "date_rated": album.date_rated.isoformat() if album.date_rated else None,
                    "_ts": album.review_at,
                })
            else:
                items.append({
                    **base,
                    "type": "rating",
                    "date_rated": album.date_rated.isoformat() if album.date_rated else None,
                    "_ts": datetime.combine(album.date_rated, datetime.min.time()) if album.date_rated else datetime.min,
                })

    # ── Recommendation events: albums a friend recommended TO you ──────────
    recommended = session.exec(
        select(Album)
        .where(Album.user_id == user_id)
        .where(Album.recommended_by.is_not(None))
        .where(Album.recommended_at.is_not(None))
        .order_by(Album.recommended_at.desc())
        .limit(50)
    ).all()
    for album in recommended:
        recommender = session.get(PressUser, album.recommended_by)
        if not recommender:
            continue
        items.append({
            "type": "recommendation",
            "friend": {"id": recommender.id, "name": recommender.name, "avatar_url": recommender.avatar_url},
            "album_id": album.id,
            "album_name": album.album_name,
            "artist": album.artist,
            "album_art_url": album.album_art_url,
            "score": None,
            "recommended_at": album.recommended_at.isoformat() if album.recommended_at else None,
            "_ts": album.recommended_at or datetime.min,
        })

    # Newest-first across both event types, then strip the internal sort key.
    items.sort(key=lambda it: it["_ts"], reverse=True)
    for it in items:
        it.pop("_ts", None)
    return items[:100]


@router.get("/reviews")
def get_friend_reviews(
    sort: str = Query("recent"),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Friends-only reviews stream for the Reviews tab.

    sort="recent" → newest first by review_at; sort="top" → most-liked first.
    Returns the full review body (the frontend truncates with a "read more").
    """
    user_id = user.id
    friendships = session.exec(
        select(Friendship).where(
            (Friendship.user_id_a == user_id) | (Friendship.user_id_b == user_id),
            Friendship.status == "accepted",
        )
    ).all()
    friend_ids = [
        f.user_id_b if f.user_id_a == user_id else f.user_id_a
        for f in friendships
    ]
    if not friend_ids:
        return []

    friends = {u.id: u for u in [session.get(PressUser, fid) for fid in friend_ids] if u}
    reviewed = session.exec(
        select(Album)
        .where(Album.user_id.in_(friend_ids))
        .where(Album.review.is_not(None))
        .where(Album.review_at.is_not(None))
        .order_by(Album.review_at.desc())
        .limit(100)
    ).all()

    album_ids = [a.id for a in reviewed]
    like_counts: dict[int, int] = {}
    comment_counts: dict[int, int] = {}
    liked_by_me: set[int] = set()
    if album_ids:
        like_counts = {
            row[0]: row[1]
            for row in session.exec(
                select(Like.album_id, func.count(Like.id))
                .where(Like.album_id.in_(album_ids))
                .group_by(Like.album_id)
            ).all()
        }
        comment_counts = {
            row[0]: row[1]
            for row in session.exec(
                select(Comment.album_id, func.count(Comment.id))
                .where(Comment.album_id.in_(album_ids))
                .group_by(Comment.album_id)
            ).all()
        }
        liked_by_me = set(session.exec(
            select(Like.album_id)
            .where(Like.album_id.in_(album_ids))
            .where(Like.user_id == user_id)
        ).all())

    items = []
    for album in reviewed:
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
            "review": album.review,
            "review_at": album.review_at.isoformat() if album.review_at else None,
            "like_count": like_counts.get(album.id, 0),
            "liked_by_me": album.id in liked_by_me,
            "comment_count": comment_counts.get(album.id, 0),
        })

    if sort == "top":
        items.sort(key=lambda it: it["like_count"], reverse=True)
    # "recent" is already ordered by the review_at DESC query above.
    return items


@router.get("/top-reviews")
def get_top_reviews(
    limit: int = Query(8),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """'What are pressers talking about' — the most-liked reviews across the
    entire userbase for the latest calendar day anyone reviewed. Userbase-wide
    (not friends-only); ranked by like count, then recency, for that one day."""
    reviewed = session.exec(
        select(Album)
        .where(Album.review.is_not(None))
        .where(Album.review_at.is_not(None))
        .order_by(Album.review_at.desc())
        .limit(300)
    ).all()
    if not reviewed:
        return {"day": None, "reviews": []}

    # The "day" is the calendar date of the most recent review; show that day's
    # talk (today when someone's reviewed today, else the last active day).
    target_day = reviewed[0].review_at.date()
    day_albums = [a for a in reviewed if a.review_at.date() == target_day]
    album_ids = [a.id for a in day_albums]

    authors = {
        u.id: u
        for u in session.exec(
            select(PressUser).where(PressUser.id.in_([a.user_id for a in day_albums]))
        ).all()
    }
    like_counts = {
        row[0]: row[1]
        for row in session.exec(
            select(Like.album_id, func.count(Like.id))
            .where(Like.album_id.in_(album_ids))
            .group_by(Like.album_id)
        ).all()
    }
    comment_counts = {
        row[0]: row[1]
        for row in session.exec(
            select(Comment.album_id, func.count(Comment.id))
            .where(Comment.album_id.in_(album_ids))
            .group_by(Comment.album_id)
        ).all()
    }
    liked_by_me = set(session.exec(
        select(Like.album_id)
        .where(Like.album_id.in_(album_ids))
        .where(Like.user_id == user.id)
    ).all())

    # Favorite / least-favorite track per album (highest / lowest scored song).
    songs_by_album: dict[int, list[Song]] = {}
    for s in session.exec(
        select(Song).where(Song.album_id.in_(album_ids)).where(Song.score.is_not(None))
    ).all():
        songs_by_album.setdefault(s.album_id, []).append(s)

    items = []
    for album in day_albums:
        author = authors.get(album.user_id)
        if not author:
            continue
        songs = songs_by_album.get(album.id, [])
        top = max(songs, key=lambda s: s.score) if songs else None
        bottom = min(songs, key=lambda s: s.score) if len(songs) >= 2 else None
        items.append({
            "author": {"id": author.id, "name": author.name, "avatar_url": author.avatar_url},
            "album_id": album.id,
            "album_name": album.album_name,
            "artist": album.artist,
            "album_art_url": album.album_art_url,
            "score": album.score,
            "review": album.review,
            "review_at": album.review_at.isoformat() if album.review_at else None,
            "like_count": like_counts.get(album.id, 0),
            "liked_by_me": album.id in liked_by_me,
            "comment_count": comment_counts.get(album.id, 0),
            "top_song": {"title": top.title, "score": top.score} if top else None,
            "bottom_song": {"title": bottom.title, "score": bottom.score} if bottom else None,
        })

    items.sort(key=lambda it: (it["like_count"], it["review_at"] or ""), reverse=True)
    return {"day": target_day.isoformat(), "reviews": items[:limit]}


@router.get("/compare")
def get_compare(
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Compare board: albums your community (you + friends) has rated, where at
    least two of you rated the same album. Each entry carries every rater's
    score + review so the client can plot them on one scale and stack them.
    Albums exactly one friend rated (and you haven't) come back as faded
    'teaser' entries — one more rating away from a comparison."""
    user_id = user.id
    friendships = session.exec(
        select(Friendship).where(
            (Friendship.user_id_a == user_id) | (Friendship.user_id_b == user_id),
            Friendship.status == "accepted",
        )
    ).all()
    friend_ids = [f.user_id_b if f.user_id_a == user_id else f.user_id_a for f in friendships]
    if not friend_ids:
        return {"items": []}

    community_ids = list({user_id, *friend_ids})
    users = {u.id: u for u in session.exec(select(PressUser).where(PressUser.id.in_(community_ids))).all()}
    albums = session.exec(
        select(Album)
        .where(Album.user_id.in_(community_ids))
        .where(Album.status == "rated")
        .where(Album.score.is_not(None))
    ).all()

    groups: dict[tuple[str, str], dict] = {}
    for a in albums:
        key = (a.album_name.strip().lower(), a.artist.strip().lower())
        g = groups.get(key)
        if g is None:
            g = {"name": a.album_name, "artist": a.artist, "year": a.year, "art": a.album_art_url, "raters": {}}
            groups[key] = g
        if not g["art"] and a.album_art_url:
            g["art"] = a.album_art_url
        if g["year"] is None and a.year:
            g["year"] = a.year
        # One rating per user per album; prefer the copy that carries a review.
        prev = g["raters"].get(a.user_id)
        if prev is None or (a.review and not prev["review"]):
            g["raters"][a.user_id] = {
                "user_id": a.user_id,
                "name": "You" if a.user_id == user_id else (users[a.user_id].name if a.user_id in users else "Friend"),
                "is_you": a.user_id == user_id,
                "score": a.score,
                "album_id": a.id,
                "review": _excerpt(a.review) if a.review else None,
                "date_rated": a.date_rated,
            }

    today = date.today()
    full: list[dict] = []
    teasers: list[dict] = []
    for g in groups.values():
        raters = list(g["raters"].values())
        friend_raters = [r for r in raters if not r["is_you"]]
        base = {
            "album_name": g["name"], "artist": g["artist"], "year": g["year"], "album_art_url": g["art"],
        }
        if len(raters) >= 2:
            ordered = sorted(raters, key=lambda r: r["score"], reverse=True)
            scores = [r["score"] for r in raters]
            you = next((r for r in raters if r["is_you"]), None)
            last = max((r["date_rated"] for r in raters if r["date_rated"]), default=date.min)
            full.append({
                **base,
                "album_id": you["album_id"] if you else ordered[0]["album_id"],
                "friend_count": len(friend_raters),
                "you_rated": you is not None,
                "spread": round(max(scores) - min(scores), 1),
                "recent": any(r["date_rated"] and (today - r["date_rated"]).days <= 7 for r in friend_raters),
                "has_reviews": any(r["review"] for r in raters),
                "raters": [{"name": r["name"], "score": r["score"], "review": r["review"], "is_you": r["is_you"]} for r in ordered],
                "_last": last,
            })
        elif len(raters) == 1 and len(friend_raters) == 1:
            r = friend_raters[0]
            teasers.append({
                **base,
                "album_id": r["album_id"],
                "friend_count": 1, "you_rated": False, "spread": 0.0, "recent": False,
                "has_reviews": False, "raters": [], "highlight": "teaser",
                "_last": r["date_rated"] or date.min,
            })

    # One album gets the "widest disagreement" call-out — the biggest real spread.
    if full:
        most_split = max(full, key=lambda it: it["spread"])
        for it in full:
            it["highlight"] = "disagreement" if (it is most_split and it["spread"] >= 1.5) else "friends"
    full.sort(key=lambda it: it["_last"], reverse=True)
    teasers.sort(key=lambda it: it["_last"], reverse=True)

    items = full + teasers[:5]
    for it in items:
        it.pop("_last", None)
    return {"items": items[:60]}


@router.post("/like")
def toggle_like(
    album_id: int = Query(...),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    user_id = user.id
    existing = session.exec(
        select(Like).where(Like.user_id == user_id, Like.album_id == album_id)
    ).first()
    if existing:
        session.delete(existing)
        session.commit()
        return {"liked": False}
    session.add(Like(user_id=user_id, album_id=album_id))
    try:
        session.commit()
    except IntegrityError:
        # Double-tap / concurrent request already inserted the like
        session.rollback()
    return {"liked": True}
