import json
import base64
import asyncio
import os
from pathlib import Path

import requests
import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/search", tags=["search"])

CONFIG_PATH = Path.home() / ".spotdl" / "config.json"


def _get_token() -> str:
    client_id = os.getenv("SPOTIFY_CLIENT_ID")
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")
    if not (client_id and client_secret):
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
        client_id = cfg["client_id"]
        client_secret = cfg["client_secret"]
    credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    resp = requests.post(
        "https://accounts.spotify.com/api/token",
        headers={"Authorization": f"Basic {credentials}"},
        data={"grant_type": "client_credentials"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def _get(url: str, headers: dict, params: dict | None = None) -> dict:
    resp = requests.get(url, headers=headers, params=params, timeout=10)
    if resp.status_code == 429:
        wait = int(resp.headers.get("Retry-After", "5"))
        raise HTTPException(
            status_code=429,
            detail=f"Spotify rate limit hit. Try again in {wait}s.",
        )
    resp.raise_for_status()
    return resp.json()


@router.get("/")
async def search_albums(q: str = Query(..., min_length=1)):
    try:
        return _search_spotify(q)
    except HTTPException as e:
        if e.status_code in (429, 503):
            print(f"[search] Spotify unavailable ({e.status_code}), falling back to iTunes")
            return await search_itunes(q)
        raise


def _search_spotify(q: str) -> list:
    try:
        token = _get_token()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Spotify auth failed: {e}")

    headers = {"Authorization": f"Bearer {token}"}

    # Detect Spotify album URL/URI → extract ID
    spotify_id = None
    if "spotify.com/album/" in q:
        spotify_id = q.split("spotify.com/album/")[1].split("?")[0].split("/")[0]
    elif q.startswith("spotify:album:"):
        spotify_id = q.split("spotify:album:")[1]

    if spotify_id:
        album_ids = [spotify_id]
    else:
        data = _get(
            "https://api.spotify.com/v1/search",
            headers=headers,
            params={"q": q, "type": "album", "limit": 5},
        )
        album_ids = [
            a["id"] for a in data.get("albums", {}).get("items", [])
            if a.get("album_type") != "single"
        ]

    results = []
    for aid in album_ids:
        try:
            album = _get(f"https://api.spotify.com/v1/albums/{aid}", headers=headers)
        except HTTPException:
            continue

        if album.get("album_type") == "single":
            continue

        release_date = album.get("release_date", "")
        year = int(release_date[:4]) if release_date else None
        images = album.get("images", [])
        cover_url = images[0]["url"] if images else None
        artists = album.get("artists", [])
        artist = artists[0]["name"] if artists else ""

        tracks_raw = album.get("tracks", {}).get("items", [])
        next_url = album.get("tracks", {}).get("next")
        while next_url:
            try:
                page = _get(next_url, headers=headers)
                tracks_raw.extend(page.get("items", []))
                next_url = page.get("next")
            except HTTPException:
                break

        tracks = [
            {
                "title": t["name"],
                "track_number": t["track_number"],
                "duration_ms": t["duration_ms"],
                "explicit": t.get("explicit", False),
                "spotify_id": t["id"],
                "artist": t["artists"][0]["name"] if t.get("artists") else artist,
            }
            for t in tracks_raw
            if t  # filter null entries (local tracks)
        ]

        results.append(
            {
                "spotify_id": aid,
                "album_name": album["name"],
                "artist": artist,
                "year": year,
                "cover_url": cover_url,
                "total_tracks": album.get("total_tracks", len(tracks)),
                "tracks": tracks,
            }
        )

    return results


@router.get("/itunes")
async def search_itunes(q: str = Query(..., min_length=1)):
    async with httpx.AsyncClient(timeout=10) as client:
        search_resp = await client.get(
            "https://itunes.apple.com/search",
            params={"term": q, "entity": "album", "limit": 5},
        )
        if not search_resp.is_success:
            raise HTTPException(status_code=502, detail="iTunes search failed")

        albums = search_resp.json().get("results", [])
        if not albums:
            return []

        results = []
        for album in albums:
            collection_id = album.get("collectionId")
            if not collection_id:
                continue

            lookup_resp = await client.get(
                "https://itunes.apple.com/lookup",
                params={"id": collection_id, "entity": "song"},
            )
            if not lookup_resp.is_success:
                continue

            items = lookup_resp.json().get("results", [])
            tracks = [
                {
                    "title": t["trackName"],
                    "track_number": t.get("trackNumber"),
                    "duration_ms": t.get("trackTimeMillis"),
                    "explicit": t.get("trackExplicitness") == "explicit",
                    "spotify_id": None,
                    "artist": t.get("artistName", album.get("artistName", "")),
                }
                for t in items
                if t.get("wrapperType") == "track" and t.get("kind") == "song"
            ]

            cover_url = album.get("artworkUrl100", "").replace("100x100bb", "1000x1000bb") or None
            release_date = album.get("releaseDate", "")
            year = int(release_date[:4]) if release_date else None

            results.append({
                "spotify_id": None,
                "album_name": album.get("collectionName", ""),
                "artist": album.get("artistName", ""),
                "year": year,
                "cover_url": cover_url,
                "total_tracks": album.get("trackCount", len(tracks)),
                "tracks": tracks,
                "genre": album.get("primaryGenreName"),
            })

        return results


MB_HEADERS = {"User-Agent": "Pressd/1.0 (music-rating-app)"}


@router.get("/mb")
async def search_mb(q: str = Query(..., min_length=1)):
    async with httpx.AsyncClient(timeout=10, headers=MB_HEADERS) as client:
        # 1. Search releases
        search_resp = await client.get(
            "https://musicbrainz.org/ws/2/release/",
            params={"query": q, "fmt": "json", "limit": 5},
        )
        if not search_resp.is_success:
            raise HTTPException(status_code=502, detail="MusicBrainz search failed")

        releases = search_resp.json().get("releases", [])[:5]
        if not releases:
            return []

        results = []
        for rel in releases:
            mbid = rel["id"]

            # 2. Fetch full tracklist (recordings)
            await asyncio.sleep(0.35)
            detail_resp = await client.get(
                f"https://musicbrainz.org/ws/2/release/{mbid}",
                params={"inc": "recordings", "fmt": "json"},
            )
            if not detail_resp.is_success:
                continue
            detail = detail_resp.json()

            # Artist
            credits = rel.get("artist-credit", [])
            artist = credits[0].get("name", "") if credits else ""

            # Year
            date_str = rel.get("date", "")
            year = int(date_str[:4]) if date_str and len(date_str) >= 4 else None

            # Tracks — flatten all media (discs)
            tracks = []
            global_pos = 0
            for medium in detail.get("media", []):
                for t in medium.get("tracks", []):
                    global_pos += 1
                    tracks.append({
                        "title": t.get("title", ""),
                        "track_number": t.get("position") or global_pos,
                        "duration_ms": t.get("length"),
                        "explicit": False,
                        "spotify_id": None,
                        "artist": artist,
                    })

            # 3. Check Cover Art Archive (HEAD to avoid downloading the image)
            cover_url = None
            try:
                await asyncio.sleep(0.15)
                caa = await client.head(
                    f"https://coverartarchive.org/release/{mbid}/front-250",
                    follow_redirects=True,
                    timeout=4,
                )
                if caa.status_code == 200:
                    cover_url = str(caa.url)
            except Exception:
                pass

            results.append({
                "spotify_id": None,
                "mb_id": mbid,
                "album_name": rel.get("title", ""),
                "artist": artist,
                "year": year,
                "cover_url": cover_url,
                "total_tracks": len(tracks),
                "tracks": tracks,
            })

        return results
