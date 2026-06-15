"""
Artist discography discovery via MusicBrainz.
Surfaces releases not yet in the local library on artist pages.
Rate limit: 1 req/sec per MusicBrainz guidelines.
"""
import json
import re
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..database import get_session
from ..models import Album, ArtistMeta

router = APIRouter(prefix="/aoty", tags=["discover"])

CACHE_TTL = timedelta(days=3)
MB_BASE = "https://musicbrainz.org/ws/2"
MB_HEADERS = {"User-Agent": "Pressd/1.0 (personal-music-rating-app)"}

# Primary types to include; Singles are excluded (too noisy)
INCLUDE_PRIMARY = {"Album", "EP"}
# Secondary types that upgrade an Album to a more specific label
SECONDARY_LABEL = {
    "Mixtape/Street": "Mixtape",
    "Compilation":    "Compilation",
    "Live":           "Live",
    "Remix":          "Remix",
}


def _normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _already_in_db(title: str, db_names: list[str]) -> bool:
    norm = _normalize(title)
    for name in db_names:
        n = _normalize(name)
        if n == norm or n.startswith(norm) or norm.startswith(n):
            return True
    return False


def _mb_get(path: str, params: dict | None = None) -> dict:
    import httpx
    url = f"{MB_BASE}/{path}"
    r = httpx.get(url, headers=MB_HEADERS, params=params, timeout=10.0)
    r.raise_for_status()
    return r.json()


def _find_artist_id(artist_name: str) -> str | None:
    data = _mb_get("artist/", {"query": artist_name, "fmt": "json", "limit": 5})
    artists = data.get("artists", [])
    if not artists:
        return None
    norm = _normalize(artist_name)
    for a in artists:
        if _normalize(a.get("name", "")) == norm:
            return a["id"]
    return artists[0]["id"]


def _fetch_releases(mb_artist_id: str) -> list[dict]:
    releases: list[dict] = []
    offset = 0
    limit = 100

    while True:
        time.sleep(1)  # MusicBrainz rate limit: 1 req/sec
        data = _mb_get(
            "release-group",
            {"artist": mb_artist_id, "fmt": "json", "limit": limit, "offset": offset},
        )
        groups = data.get("release-groups", [])
        total = data.get("release-group-count", 0)

        for g in groups:
            primary = g.get("primary-type", "")
            if primary not in INCLUDE_PRIMARY:
                continue

            secondary = g.get("secondary-types", [])
            # Determine display type
            release_type = primary
            for sec in secondary:
                if sec in SECONDARY_LABEL:
                    release_type = SECONDARY_LABEL[sec]
                    break

            if release_type in {"Live", "Compilation"}:
                continue

            mb_id = g["id"]
            date = g.get("first-release-date", "")
            year = int(date[:4]) if date and len(date) >= 4 else None

            releases.append({
                "title": g["title"],
                "year": year,
                "type": release_type,
                "mb_id": mb_id,
                # Cover Art Archive — browser loads this lazily, no extra backend request
                "cover_url": f"https://coverartarchive.org/release-group/{mb_id}/front-250",
                "score": None,
            })

        offset += len(groups)
        if offset >= total or not groups:
            break

    # Sort by year descending
    return sorted(releases, key=lambda r: r["year"] or 0, reverse=True)


def _refresh(artist_name: str, session: Session) -> ArtistMeta | None:
    mb_id = _find_artist_id(artist_name)
    if not mb_id:
        return None

    time.sleep(1)
    releases = _fetch_releases(mb_id)

    meta = session.exec(
        select(ArtistMeta).where(ArtistMeta.artist == artist_name)
    ).first()
    if meta is None:
        meta = ArtistMeta(artist=artist_name)
        session.add(meta)

    meta.mb_artist_id = mb_id
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
        raise HTTPException(404, detail="Artist not found on MusicBrainz")

    all_releases: list[dict] = json.loads(meta.albums_json)

    from .albums import artist_in_album
    all_db_albums = session.exec(select(Album)).all()
    db_names = [a.album_name for a in all_db_albums if artist_in_album(a, artist_name)]

    EXCLUDE_TYPES = {"Live", "Compilation"}
    filtered = [r for r in all_releases if r.get("type") not in EXCLUDE_TYPES]
    unrated = [r for r in filtered if not _already_in_db(r["title"], db_names)]

    return {
        "mb_artist_id": meta.mb_artist_id,
        "total_on_mb": len(filtered),
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
        raise HTTPException(404, detail="Artist not found on MusicBrainz")
    return {"ok": True, "releases": len(json.loads(meta.albums_json or "[]"))}
