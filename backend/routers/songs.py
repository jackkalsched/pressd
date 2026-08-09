from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..database import get_session
from ..deps import current_user, authorize_view, viewable_user_id
from ..models import Song, Album, PressUser
from ..scoring import compute_a_score, compute_album_score, get_factor_stats, get_user_weights, EP_MAX_TRACKS
from ..global_rating import invalidate_cache as invalidate_global_ratings

router = APIRouter(prefix="/songs", tags=["songs"])


@router.get("/")
def list_songs(
    artist: Optional[str] = Query(None),
    album_id: Optional[int] = Query(None),
    min_score: Optional[float] = Query(None),
    user_id: Optional[int] = Query(None),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    target_id = user_id if user_id is not None else user.id
    authorize_view(user, target_id, session)
    q = select(Song).join(Album, Song.album_id == Album.id).where(Album.user_id == target_id)
    if artist:
        q = q.where(Song.artist == artist)
    if album_id:
        q = q.where(Song.album_id == album_id)
    if min_score is not None:
        q = q.where(Song.score >= min_score)
    return session.exec(q.order_by(Song.score.desc())).all()


# A library of 400 albums carries five thousand scored songs, and the picker
# only ever needs the top of that list — so the board is capped and search runs
# server-side rather than shipping the whole thing to filter on the phone.
RANKED_SONG_LIMIT = 400


@router.get("/ranked")
def ranked_songs(
    q: Optional[str] = Query(None, description="match song, album or artist"),
    limit: int = Query(RANKED_SONG_LIMIT, ge=1, le=2000),
    target_id: int = Depends(viewable_user_id),
    session: Session = Depends(get_session),
):
    """A user's scored songs, best first, each carrying its album's name and art.

    `GET /songs/` orders by score too, but it returns bare Song rows including
    unscored ones — and in Postgres a descending sort puts those nulls first, so
    the top of that list is the part nobody has rated. This one is the leaderboard
    the favourite-song picker reads: scored only, and joined to the album so a row
    can show cover art without a fetch per song.
    """
    stmt = (
        select(Song, Album)
        .join(Album, Song.album_id == Album.id)
        .where(Album.user_id == target_id, Song.score.is_not(None))
    )
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            Song.title.ilike(like) | Album.album_name.ilike(like) | Album.artist.ilike(like)
        )
    rows = session.exec(stmt.order_by(Song.score.desc()).limit(limit)).all()
    return [
        {
            "id": song.id,
            "title": song.title,
            "score": song.score,
            "album_id": album.id,
            "album_name": album.album_name,
            # Song.artist is set per track for features and compilations; the
            # album's is the fallback, not the other way round.
            "artist": song.artist or album.artist,
            "album_art_url": album.album_art_url,
        }
        for song, album in rows
    ]


@router.post("/batch-rate")
def batch_rate_songs(
    data: list[dict],
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Rate multiple songs in a single transaction. Expects [{id, score}, ...]."""
    user_id = user.id
    for item in data:
        song = session.get(Song, item["id"])
        if not song:
            continue
        album = session.get(Album, song.album_id)
        if not album or album.user_id != user_id:
            raise HTTPException(status_code=403, detail="Not your album")
        score = item.get("score")
        song.score = score
        song.a_score = compute_a_score(score) if score is not None else None
        session.add(song)
    session.commit()
    return {"ok": True}


@router.patch("/{song_id}")
def rate_song(
    song_id: int,
    data: dict,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    user_id = user.id
    song = session.get(Song, song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    album = session.get(Album, song.album_id)
    if not album or album.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not your album")

    if "score" in data:
        score = data["score"]
        song.score = score
        song.a_score = compute_a_score(score) if score is not None else None

    session.add(song)

    # Recompute album score if all songs rated: composite when the four
    # factors are set, song mean for EPs (which skip factors by design)
    album = session.get(Album, song.album_id)
    if album:
        rated = [s.score for s in album.songs if s.score is not None]
        has_factors = (
            album.theme is not None
            and album.replay_value is not None
            and album.production is not None
            and album.distinctness is not None
        )
        if len(rated) == len(album.songs) and has_factors:
            factor_stats = get_factor_stats(session, user_id=album.user_id)
            owner = session.get(PressUser, album.user_id)
            album.score = compute_album_score(
                rated, album.theme, album.replay_value,
                album.production, album.distinctness,
                factor_stats, get_user_weights(owner) if owner else None,
            )
            session.add(album)
        elif (len(rated) == len(album.songs) and not has_factors
              and len(album.songs) <= EP_MAX_TRACKS):
            album.score = round(sum(rated) / len(rated), 2)
            session.add(album)

    session.commit()
    invalidate_global_ratings()   # a song score feeds the pooled board
    session.refresh(song)
    return song
