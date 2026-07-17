"""
New-release discovery via Deezer's public editorial API (no auth required).

`/discover/new-releases` returns a lightweight, cached list of recent releases.
`/discover/deezer/{id}` resolves one release to the full album+tracks shape the
existing album-import flow consumes, so a card can be added to a user's library
or opened straight into the rating screen.
"""
import time
from datetime import date, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..database import get_session
from ..deps import current_user
from ..models import Album, PressUser

router = APIRouter(prefix="/discover", tags=["discover"])

DEEZER_BASE = "https://api.deezer.com"
CACHE_TTL = 6 * 3600  # editorial releases move slowly; refresh a few times a day
_cache: dict = {"releases": None, "expires": 0.0}


def _cover(a: dict) -> str | None:
    return a.get("cover_xl") or a.get("cover_big") or a.get("cover_medium") or None


def _year(release_date: str | None) -> int | None:
    return int(release_date[:4]) if release_date and release_date[:4].isdigit() else None


@router.get("/new-releases")
async def new_releases(
    limit: int = Query(12, ge=1, le=30),
    user: PressUser = Depends(current_user),
):
    now = time.monotonic()
    if _cache["releases"] and _cache["expires"] > now:  # only serve a non-empty cache
        return _cache["releases"][:limit]

    async with httpx.AsyncClient(timeout=12) as client:
        resp = await client.get(f"{DEEZER_BASE}/editorial/0/releases", params={"limit": 40})
        items = resp.json().get("data", []) if resp.is_success else []
        if not items:
            # Deezer has stopped populating its editorial "releases" feed, so fall
            # back to the editorial "selection" — a curated set of trending albums
            # (fresher/more intentional than the raw top-albums chart).
            resp = await client.get(f"{DEEZER_BASE}/editorial/0/selection", params={"limit": 40})
            if not resp.is_success:
                raise HTTPException(status_code=502, detail="Could not load trending releases")
            items = resp.json().get("data", [])

    releases: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for a in items:
        aid = a.get("id")
        title = a.get("title")
        artist = (a.get("artist") or {}).get("name")
        if not (aid and title and artist):
            continue
        key = (title.lower(), artist.lower())
        if key in seen:
            continue
        seen.add(key)
        rd = a.get("release_date") or ""
        releases.append({
            "deezer_id": aid,
            "album_name": title,
            "artist": artist,
            "cover_url": _cover(a),
            "year": _year(rd),
            "release_date": rd or None,
            "nb_tracks": a.get("nb_tracks"),
        })

    if releases:  # never cache an empty result — retry on the next request
        _cache["releases"] = releases
        _cache["expires"] = now + CACHE_TTL
    return releases[:limit]


@router.get("/trending")
def trending(
    period: str = Query("week", pattern="^(week|all|top)$"),
    limit: int = Query(8, ge=1, le=20),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Popular albums across the whole userbase.

    Albums are stored as per-user copies, so we group every rated copy by
    (album, artist) and rank the groups:
      - week: rated in the last 7 days, by number of distinct raters, then recency
      - all:  all-time, by number of distinct raters, then recency
      - top:  all-time, by average score

    Each row links to the current user's own copy when they have one, otherwise
    to the most recently rated copy.
    """
    q = (
        select(Album)
        .where(Album.status == "rated")
        .where(Album.score.is_not(None))
    )
    if period == "week":
        q = q.where(Album.date_rated >= date.today() - timedelta(days=7))
    albums = session.exec(q).all()

    groups: dict[tuple[str, str], dict] = {}
    for a in albums:
        key = (a.album_name.strip().lower(), a.artist.strip().lower())
        g = groups.get(key)
        if g is None:
            g = {
                "album_name": a.album_name, "artist": a.artist, "year": a.year,
                "album_art_url": a.album_art_url, "scores": [], "raters": set(),
                "last": None, "own_album_id": None,
                "rep_album_id": a.id, "rep_last": a.date_rated,
            }
            groups[key] = g
        g["scores"].append(a.score)
        if a.user_id is not None:
            g["raters"].add(a.user_id)
        if a.album_art_url and not g["album_art_url"]:
            g["album_art_url"] = a.album_art_url
        if a.date_rated and (g["last"] is None or a.date_rated > g["last"]):
            g["last"] = a.date_rated
        if a.date_rated and (g["rep_last"] is None or a.date_rated > g["rep_last"]):
            g["rep_last"], g["rep_album_id"] = a.date_rated, a.id
        if a.user_id == user.id:
            g["own_album_id"] = a.id

    rows = [
        {
            "album_id": g["own_album_id"] or g["rep_album_id"],
            "album_name": g["album_name"],
            "artist": g["artist"],
            "album_art_url": g["album_art_url"],
            "year": g["year"],
            "avg_score": round(sum(g["scores"]) / len(g["scores"]), 2) if g["scores"] else None,
            "rater_count": len(g["raters"]),
            "last_rated": g["last"].isoformat() if g["last"] else None,
        }
        for g in groups.values()
    ]

    if period == "top":
        rows.sort(key=lambda r: (r["avg_score"] or 0, r["rater_count"]), reverse=True)
    else:
        rows.sort(key=lambda r: (r["rater_count"], r["last_rated"] or ""), reverse=True)
    return rows[:limit]


@router.get("/deezer/{deezer_id}")
async def resolve_deezer_album(
    deezer_id: int,
    user: PressUser = Depends(current_user),
):
    """Full album + tracks in the SpotifyAlbumResult shape used by /albums/import."""
    async with httpx.AsyncClient(timeout=12) as client:
        resp = await client.get(f"{DEEZER_BASE}/album/{deezer_id}")
        if not resp.is_success:
            raise HTTPException(status_code=404, detail="Album not found on Deezer")
        album = resp.json()
        tracks_data = (album.get("tracks") or {}).get("data")
        if tracks_data is None:
            tr = await client.get(f"{DEEZER_BASE}/album/{deezer_id}/tracks", params={"limit": 100})
            tracks_data = tr.json().get("data", []) if tr.is_success else []

    artist_name = (album.get("artist") or {}).get("name", "")
    tracks = [
        {
            "title": t.get("title", ""),
            "track_number": t.get("track_position") or i + 1,
            "duration_ms": (t.get("duration") or 0) * 1000,
            "explicit": t.get("explicit_lyrics", False),
            "spotify_id": None,
            "artist": (t.get("artist") or {}).get("name", "") or artist_name,
        }
        for i, t in enumerate(tracks_data)
    ]

    return {
        "spotify_id": None,
        "album_name": album.get("title", ""),
        "artist": artist_name,
        "year": _year(album.get("release_date")),
        "cover_url": _cover(album),
        "total_tracks": album.get("nb_tracks") or len(tracks),
        "tracks": tracks,
    }
