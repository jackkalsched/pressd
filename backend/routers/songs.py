from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..database import get_session
from ..deps import current_user, authorize_view
from ..models import Song, Album, PressUser
from ..scoring import compute_a_score, compute_album_score, get_factor_stats, EP_MAX_TRACKS

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
            album.score = compute_album_score(
                rated, album.theme, album.replay_value,
                album.production, album.distinctness,
                factor_stats,
            )
            session.add(album)
        elif (len(rated) == len(album.songs) and not has_factors
              and len(album.songs) <= EP_MAX_TRACKS):
            album.score = round(sum(rated) / len(rated), 2)
            session.add(album)

    session.commit()
    session.refresh(song)
    return song
