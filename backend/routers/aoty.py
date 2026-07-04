"""
Artist discography discovery via Discogs.
Surfaces releases not yet in the local library on artist pages.
Set DISCOGS_TOKEN env var (personal access token from discogs.com/settings/developers)
for authenticated requests (60 req/min vs 25 unauthenticated).
"""
import json
import os
import re
from datetime import datetime, timedelta

import requests
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..database import get_session
from ..models import Album, ArtistMeta

router = APIRouter(prefix="/aoty", tags=["discover"])

CACHE_TTL = timedelta(days=3)
DISCOGS_BASE = "https://api.discogs.com"

# Format keywords that disqualify a release
_EXCLUDE_FORMATS = {
    "single", "compilation", "live", "interview",
    "soundtrack", "mixtape", "dj mix", "video", "dvd", "vhs", "cassette single",
}


def _headers() -> dict:
    token = os.getenv("DISCOGS_TOKEN")
    ua = "Pressd/1.0 (personal-music-rating-app)"
    if token:
        return {"Authorization": f"Discogs token={token}", "User-Agent": ua}
    return {"User-Agent": ua}


def _get(url: str, params: dict | None = None) -> dict:
    resp = requests.get(url, headers=_headers(), params=params, timeout=12)
    if resp.status_code == 429:
        raise HTTPException(429, detail="Discogs rate limit hit — try again shortly.")
    resp.raise_for_status()
    return resp.json()


def _normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _already_in_db(title: str, db_names: list[str]) -> bool:
    norm = _normalize(title)
    for name in db_names:
        n = _normalize(name)
        if n == norm or n.startswith(norm) or norm.startswith(n):
            return True
    return False


def _is_studio_album(release: dict) -> bool:
    if release.get("type") != "master":
        return False
    if release.get("role", "").lower() != "main":
        return False
    fmt = release.get("format", "").lower()
    if not fmt:
        return True
    parts = {p.strip() for p in fmt.split(",")}
    return not (parts & _EXCLUDE_FORMATS)


def _clean_cover(url: str | None) -> str | None:
    if not url:
        return None
    # Discard Discogs generic placeholder images
    if "spacer.gif" in url or "placeholder" in url.lower():
        return None
    return url


def _find_artist_id(artist_name: str) -> str | None:
    data = _get(
        f"{DISCOGS_BASE}/database/search",
        params={"q": artist_name, "type": "artist", "per_page": 5},
    )
    results = data.get("results", [])
    if not results:
        return None
    norm = _normalize(artist_name)
    for r in results:
        if _normalize(r.get("title", "")) == norm:
            return str(r["id"])
    return str(results[0]["id"])


def _fetch_releases(artist_id: str) -> list[dict]:
    releases: list[dict] = []
    page = 1

    while True:
        data = _get(
            f"{DISCOGS_BASE}/artists/{artist_id}/releases",
            params={"sort": "year", "sort_order": "desc", "per_page": 100, "page": page},
        )
        items = data.get("releases", [])
        pagination = data.get("pagination", {})

        for item in items:
            if not _is_studio_album(item):
                continue
            year = item.get("year") or None
            cover = _clean_cover(item.get("cover_image")) or _clean_cover(item.get("thumb"))
            fmt_lower = item.get("format", "").lower()
            release_type = "EP" if "ep" in {p.strip() for p in fmt_lower.split(",")} else "Album"
            releases.append({
                "title": item["title"],
                "year": year,
                "type": release_type,
                "mb_id": str(item.get("id", "")),
                "cover_url": cover,
                "score": None,
            })

        if page >= pagination.get("pages", 1) or not items:
            break
        page += 1

    # Deduplicate by normalized title (keep first / earliest seen, which is most recent year)
    seen: set[str] = set()
    deduped: list[dict] = []
    for r in releases:
        key = _normalize(r["title"])
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    return sorted(deduped, key=lambda r: r["year"] or 0, reverse=True)


def _refresh(artist_name: str, session: Session) -> ArtistMeta | None:
    artist_id = _find_artist_id(artist_name)
    if not artist_id:
        return None

    releases = _fetch_releases(artist_id)

    meta = session.exec(
        select(ArtistMeta).where(ArtistMeta.artist == artist_name)
    ).first()
    if meta is None:
        meta = ArtistMeta(artist=artist_name)
        session.add(meta)

    meta.mb_artist_id = artist_id
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
    cached_empty = (
        meta is not None
        and meta.albums_json is not None
        and json.loads(meta.albums_json) == []
    )
    stale = (
        meta is None
        or meta.albums_json is None
        or meta.scraped_at is None
        or cached_empty
        or (now - meta.scraped_at) > CACHE_TTL
    )
    if stale:
        meta = _refresh(artist_name, session)

    return meta


@router.get("/artist/{artist_name}")
def discover_artist(artist_name: str, session: Session = Depends(get_session)):
    meta = _get_or_refresh(artist_name, session)
    if not meta or not meta.albums_json:
        raise HTTPException(404, detail="Artist not found on Discogs")

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
        raise HTTPException(404, detail="Artist not found on Discogs")
    return {"ok": True, "releases": len(json.loads(meta.albums_json or "[]"))}
