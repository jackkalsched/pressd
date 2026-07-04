"""
Artist discography discovery via Spotify.
Surfaces releases not yet in the local library on artist pages.
"""
import json
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..database import get_session
from ..models import Album, ArtistMeta
from .search import _get_token, _get as _spotify_get

router = APIRouter(prefix="/aoty", tags=["discover"])

CACHE_TTL = timedelta(days=3)
SPOTIFY_BASE = "https://api.spotify.com/v1"


def _normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _already_in_db(title: str, db_names: list[str]) -> bool:
    norm = _normalize(title)
    for name in db_names:
        n = _normalize(name)
        if n == norm or n.startswith(norm) or norm.startswith(n):
            return True
    return False


def _find_spotify_artist_id(artist_name: str, token: str) -> str | None:
    headers = {"Authorization": f"Bearer {token}"}
    data = _spotify_get(
        f"{SPOTIFY_BASE}/search",
        headers=headers,
        params={"q": artist_name, "type": "artist", "limit": 5},
    )
    artists = data.get("artists", {}).get("items", [])
    if not artists:
        return None
    norm = _normalize(artist_name)
    for a in artists:
        if _normalize(a.get("name", "")) == norm:
            return a["id"]
    return artists[0]["id"]


def _fetch_releases(spotify_artist_id: str, token: str) -> list[dict]:
    headers = {"Authorization": f"Bearer {token}"}
    url: str | None = f"{SPOTIFY_BASE}/artists/{spotify_artist_id}/albums"
    params: dict | None = {"include_groups": "album", "limit": 50, "market": "US"}
    releases: list[dict] = []

    while url:
        data = _spotify_get(url, headers=headers, params=params)
        params = None  # subsequent pages use the full next URL
        for item in data.get("items", []):
            release_date = item.get("release_date", "")
            year = int(release_date[:4]) if release_date and len(release_date) >= 4 else None
            images = item.get("images", [])
            cover_url = images[0]["url"] if images else None
            releases.append({
                "title": item["name"],
                "year": year,
                "type": "Album",
                "mb_id": item["id"],  # Spotify album ID used as unique key
                "cover_url": cover_url,
                "score": None,
            })
        url = data.get("next")

    # Deduplicate by normalized title (Spotify sometimes lists deluxe + standard editions)
    seen: set[str] = set()
    deduped: list[dict] = []
    for r in releases:
        key = _normalize(r["title"])
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    return sorted(deduped, key=lambda r: r["year"] or 0, reverse=True)


def _refresh(artist_name: str, session: Session) -> ArtistMeta | None:
    try:
        token = _get_token()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Spotify auth failed: {e}")

    spotify_id = _find_spotify_artist_id(artist_name, token)
    if not spotify_id:
        return None

    releases = _fetch_releases(spotify_id, token)

    meta = session.exec(
        select(ArtistMeta).where(ArtistMeta.artist == artist_name)
    ).first()
    if meta is None:
        meta = ArtistMeta(artist=artist_name)
        session.add(meta)

    meta.mb_artist_id = spotify_id
    meta.albums_json = json.dumps(releases)
    meta.scraped_at = datetime.utcnow()
    session.commit()
    session.refresh(meta)
    return meta


def _get_or_refresh(artist_name: str, session: Session) -> ArtistMeta | None:
    meta = session.exec(
        select(ArtistMeta).where(ArtistMeta.artist == artist_name)
    ).first()

    now = datetime.utcnow()
    stale = (
        meta is None
        or meta.albums_json is None
        or meta.scraped_at is None
        or (now - meta.scraped_at) > CACHE_TTL
    )
    if stale:
        meta = _refresh(artist_name, session)

    return meta


@router.get("/artist/{artist_name}")
def discover_artist(artist_name: str, session: Session = Depends(get_session)):
    meta = _get_or_refresh(artist_name, session)
    if not meta or not meta.albums_json:
        raise HTTPException(404, detail="Artist not found on Spotify")

    all_releases: list[dict] = json.loads(meta.albums_json)

    from .albums import artist_in_album
    all_db_albums = session.exec(select(Album)).all()
    db_names = [a.album_name for a in all_db_albums if artist_in_album(a, artist_name)]

    unrated = [r for r in all_releases if not _already_in_db(r["title"], db_names)]

    return {
        "mb_artist_id": meta.mb_artist_id,
        "total_on_mb": len(all_releases),
        "unrated": unrated,
    }


@router.post("/artist/{artist_name}/refresh")
def force_refresh(artist_name: str, session: Session = Depends(get_session)):
    meta = session.exec(
        select(ArtistMeta).where(ArtistMeta.artist == artist_name)
    ).first()
    if meta:
        meta.scraped_at = None
        session.commit()

    meta = _refresh(artist_name, session)
    if not meta:
        raise HTTPException(404, detail="Artist not found on Spotify")
    return {"ok": True, "releases": len(json.loads(meta.albums_json or "[]"))}
