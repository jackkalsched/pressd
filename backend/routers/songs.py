from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..database import get_session
from ..models import Song, Album
from ..scoring import compute_a_score, compute_album_score, get_factor_stats

router = APIRouter(prefix="/songs", tags=["songs"])


@router.get("/")
def list_songs(
    artist: Optional[str] = Query(None),
    album_id: Optional[int] = Query(None),
    min_score: Optional[float] = Query(None),
    user_id: int = Query(1),
    session: Session = Depends(get_session),
):
    q = select(Song).join(Album, Song.album_id == Album.id).where(Album.user_id == user_id)
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
    user_id: int = Query(1),
    session: Session = Depends(get_session),
):
    """Rate multiple songs in a single transaction. Expects [{id, score}, ...]."""
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
    user_id: int = Query(1),
    session: Session = Depends(get_session),
):
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

    # Recompute album score if all songs rated and factors set
    album = session.get(Album, song.album_id)
    if album:
        rated = [s.score for s in album.songs if s.score is not None]
        if (
            len(rated) == len(album.songs)
            and album.theme is not None
            and album.replay_value is not None
            and album.production is not None
            and album.distinctness is not None
        ):
            factor_stats = get_factor_stats(session)
            album.score = compute_album_score(
                rated, album.theme, album.replay_value,
                album.production, album.distinctness,
                factor_stats,
            )
            session.add(album)

    session.commit()
    session.refresh(song)
    return song
