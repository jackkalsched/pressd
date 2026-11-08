"""The single search box: people, records, artists and songs in one call.

Two-step candidate loading, on purpose. The first query finds copies whose own
text touches the query; the second loads *every* copy of those records (by
`subject_key`), because `search_rank` counts raters and decides which records
qualify from the candidates it is handed. Handing it only the copies whose name
matched would undercount a record whose other editions are spelled differently.
Each first query is capped (400 copies, 40 people) so a one-letter-ish query
stays cheap.

A record is visible when the caller owns a copy or someone has rated one; the
SQL applies that condition so a stranger's To Listen never leaves the database.
Singles are included: the library hides them, search shouldn't.

`/search/known` is for the catalog search: which of the albums a catalog returned
does Pressd already have, so the client can open the Pressd record instead of
offering to import it.
"""
from types import SimpleNamespace
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlmodel import Session, select

from ..database import get_session
from ..deps import current_user
from ..models import Album, PressUser, Song, Track
from ..search_rank import (
    _records, albums_group, artists_group, fold, people_group, songs_group,
)
from ..trackkeys import subject_key_album
from . import users

router = APIRouter(prefix="/search", tags=["search"], dependencies=[Depends(current_user)])

ALLOWED_GROUPS = ("people", "albums", "artists", "songs")
PREVIEW = 4
FULL = 25
MAX_KNOWN = 50
ALBUM_CAP = 400
SONG_CAP = 400
PEOPLE_CAP = 40


def effective_limit(group: Optional[str], limit: Optional[int]) -> int:
    """Rows per group: a given limit (capped at FULL); else FULL for one group's
    "See all", and the preview plus one for the overview, whose extra row is how
    a client knows there is more than it shows."""
    if limit is None:
        return FULL if group else PREVIEW + 1
    return min(limit, FULL)


def like_pattern(q: str) -> str:
    q = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{q}%"


def parse_known(items) -> list[tuple[str, str]]:
    if not isinstance(items, list) or len(items) > MAX_KNOWN:
        raise ValueError(f"at most {MAX_KNOWN} albums")
    out = []
    for it in items:
        if not isinstance(it, dict) or not isinstance(it.get("name"), str) or not isinstance(it.get("artist"), str):
            raise ValueError("each item needs a name and an artist")
        out.append((it["name"], it["artist"]))
    return out


def _visible(me: int):
    """The caller's copies, and anyone's rated ones."""
    return or_(Album.user_id == me, Album.status == "rated")


def _album_cands(session: Session, me: int, where) -> list:
    """Two steps: matching copies, then every visible copy of those records."""
    keys = session.exec(
        select(Album.subject_key).where(where, _visible(me), Album.subject_key.is_not(None))
        .order_by((Album.user_id == me).desc(), Album.id.desc()).limit(ALBUM_CAP)
    ).all()
    keys = set(keys)
    if not keys:
        return []
    tracks = (select(func.count(Song.id)).where(Song.album_id == Album.id).scalar_subquery())
    rows = session.exec(
        select(Album, tracks).where(Album.subject_key.in_(keys), _visible(me))
    ).all()
    return [SimpleNamespace(
        id=a.id, user_id=a.user_id, album_name=a.album_name, artist=a.artist,
        subject_key=a.subject_key, status=a.status, score=a.score,
        art_url=a.album_art_url, extra_artists=a.extra_artists, track_count=n or 0,
    ) for a, n in rows]


def _song_cands(session: Session, me: int, p: str, pf: str) -> list:
    ids = session.exec(
        select(Song.track_id).join(Album, Album.id == Song.album_id).join(Track, Track.id == Song.track_id)
        .where(
            Song.track_id.is_not(None), _visible(me),
            or_(Song.title.ilike(p, escape="\\"), Track.title_norm.ilike(pf, escape="\\")),
        ).order_by((Album.user_id == me).desc(), Song.id.desc()).limit(SONG_CAP)
    ).all()
    ids = set(ids)
    if not ids:
        return []
    rows = session.exec(
        select(Song, Album).join(Album, Album.id == Song.album_id)
        .where(Song.track_id.in_(ids), _visible(me))
    ).all()
    return [SimpleNamespace(
        track_id=s.track_id, title=s.title, album_id=a.id, album_name=a.album_name,
        art_url=a.album_art_url, artist=a.artist, subject_key=a.subject_key, user_id=a.user_id, status=a.status,
    ) for s, a in rows]


@router.get("/all")
def search_all(
    q: str = Query(""),
    group: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=1),
    session: Session = Depends(get_session),
    me: PressUser = Depends(current_user),
):
    if group is not None and group not in ALLOWED_GROUPS:
        raise HTTPException(status_code=422, detail=f"group must be one of {', '.join(ALLOWED_GROUPS)}")
    limit = effective_limit(group, limit)
    wanted = (group,) if group else ALLOWED_GROUPS
    out: dict[str, list] = {g: [] for g in wanted}
    q = q.strip()
    if len(q) < 2:
        return out
    p, pf = like_pattern(q), like_pattern(fold(q))

    if "people" in wanted:
        found = session.exec(
            select(PressUser).where(PressUser.name.ilike(p, escape="\\"), PressUser.id != me.id)
            .limit(PEOPLE_CAP)
        ).all()
        rel = users._relationships(session, me.id)
        out["people"] = people_group(q, [users._with_relationship(u, rel) for u in found], limit)

    if "albums" in wanted or "artists" in wanted:
        where = or_(
            Album.album_name.ilike(p, escape="\\"), Album.artist.ilike(p, escape="\\"),
            Album.extra_artists.ilike(p, escape="\\"), Album.subject_key.ilike(pf, escape="\\"),
        )
        cands = _album_cands(session, me.id, where)
        if "albums" in wanted:
            out["albums"] = albums_group(q, cands, me.id, limit)
        if "artists" in wanted:
            out["artists"] = artists_group(q, cands, me.id, limit)

    if "songs" in wanted:
        out["songs"] = songs_group(q, _song_cands(session, me.id, p, pf), me.id, limit)
    return out


@router.post("/known")
def known(
    body=Body(...),
    session: Session = Depends(get_session),
    me: PressUser = Depends(current_user),
):
    try:
        items = parse_known(body)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    keys = [subject_key_album(artist, name) for name, artist in items]
    wanted = {k for k in keys if k}
    if not wanted:
        return []
    copies = session.exec(
        select(Album).where(Album.subject_key.in_(wanted), _visible(me.id))
    ).all()
    reps = {r["rep"].subject_key: r["rep"].id for r in _records(copies, me.id)}
    return [
        {"index": i, "subject_key": k, "album_id": reps[k]}
        for i, k in enumerate(keys) if k in reps
    ]
