import json
import base64
import asyncio
import os
import time
from datetime import date
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/search", tags=["search"])

CONFIG_PATH = Path.home() / ".spotdl" / "config.json"

# ── Result cache ──────────────────────────────────────────────────────────────
# In-process TTL cache keyed by (source, normalized query). Repeat searches are
# instant and the outbound APIs are protected — MusicBrainz in particular is
# globally rate-limited to ~1 req/s, so cache misses must be the exception.
_CACHE_TTL = 600  # seconds
_CACHE_MAX = 500
_cache: dict[str, tuple[float, list]] = {}


def _cache_get(source: str, q: str) -> list | None:
    entry = _cache.get(f"{source}:{q.strip().lower()}")
    if entry and entry[0] > time.monotonic():
        return entry[1]
    return None


def _cache_set(source: str, q: str, data: list) -> None:
    if len(_cache) >= _CACHE_MAX:
        for key, _ in sorted(_cache.items(), key=lambda kv: kv[1][0])[: _CACHE_MAX // 2]:
            _cache.pop(key, None)
    _cache[f"{source}:{q.strip().lower()}"] = (time.monotonic() + _CACHE_TTL, data)


# ── Spotify ───────────────────────────────────────────────────────────────────
# Client-credentials token is cached until shortly before expiry instead of
# being re-fetched on every search.
_spotify_token: dict = {"token": None, "expires_at": 0.0}
_token_lock = asyncio.Lock()


async def _get_token(client: httpx.AsyncClient) -> str:
    if _spotify_token["token"] and _spotify_token["expires_at"] > time.monotonic() + 60:
        return _spotify_token["token"]
    async with _token_lock:
        if _spotify_token["token"] and _spotify_token["expires_at"] > time.monotonic() + 60:
            return _spotify_token["token"]
        client_id = os.getenv("SPOTIFY_CLIENT_ID")
        client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")
        if not (client_id and client_secret):
            with open(CONFIG_PATH) as f:
                cfg = json.load(f)
            client_id = cfg["client_id"]
            client_secret = cfg["client_secret"]
        credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        resp = await client.post(
            "https://accounts.spotify.com/api/token",
            headers={"Authorization": f"Basic {credentials}"},
            data={"grant_type": "client_credentials"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        _spotify_token["token"] = data["access_token"]
        _spotify_token["expires_at"] = time.monotonic() + data.get("expires_in", 3600)
        return _spotify_token["token"]


async def _sp_get(client: httpx.AsyncClient, url: str, headers: dict, params: dict | None = None) -> dict:
    resp = await client.get(url, headers=headers, params=params, timeout=10)
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
    cached = _cache_get("spotify", q)
    if cached is not None:
        return cached
    try:
        results = await _search_spotify(q)
    except HTTPException as e:
        if e.status_code in (429, 503):
            print(f"[search] Spotify unavailable ({e.status_code}), falling back to iTunes")
            return await search_itunes(q)
        raise
    _cache_set("spotify", q, results)
    return results


async def _search_spotify(q: str) -> list:
    async with httpx.AsyncClient() as client:
        try:
            token = await _get_token(client)
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
            data = await _sp_get(
                client,
                "https://api.spotify.com/v1/search",
                headers=headers,
                params={"q": f'album:"{q}"', "type": "album", "limit": 10},
            )
            q_norm = q.strip().lower()
            album_ids = [
                a["id"] for a in data.get("albums", {}).get("items", [])
                if a.get("album_type") != "single"
                and a.get("name", "").strip().lower() == q_norm
            ]

        results = []
        for aid in album_ids:
            try:
                album = await _sp_get(client, f"https://api.spotify.com/v1/albums/{aid}", headers=headers)
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
                    page = await _sp_get(client, next_url, headers=headers)
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
    cached = _cache_get("itunes", q)
    if cached is not None:
        return cached
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

        _cache_set("itunes", q, results)
        return results


@router.get("/deezer")
async def search_deezer(q: str = Query(..., min_length=1)):
    cached = _cache_get("deezer", q)
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=12) as client:
        search_resp = await client.get(
            "https://api.deezer.com/search/album",
            params={"q": q, "limit": 8},
        )
        if not search_resp.is_success:
            raise HTTPException(status_code=502, detail="Deezer search failed")

        albums = search_resp.json().get("data", [])[:6]
        if not albums:
            return []

        results = []
        for album in albums:
            album_id = album.get("id")
            if not album_id:
                continue

            tracks_resp = await client.get(
                f"https://api.deezer.com/album/{album_id}/tracks",
                params={"limit": 100},
            )
            tracks = []
            if tracks_resp.is_success:
                for i, t in enumerate(tracks_resp.json().get("data", [])):
                    tracks.append({
                        "title": t.get("title", ""),
                        "track_number": t.get("track_position") or i + 1,
                        "duration_ms": (t.get("duration") or 0) * 1000,
                        "explicit": t.get("explicit_lyrics", False),
                        "spotify_id": None,
                        "artist": t.get("artist", {}).get("name", "")
                            or album.get("artist", {}).get("name", ""),
                    })

            release_date = album.get("release_date", "")
            year = int(release_date[:4]) if release_date and len(release_date) >= 4 else None
            cover_url = (
                album.get("cover_xl")
                or album.get("cover_big")
                or album.get("cover_medium")
                or None
            )

            results.append({
                "spotify_id": None,
                "album_name": album.get("title", ""),
                "artist": album.get("artist", {}).get("name", ""),
                "year": year,
                "cover_url": cover_url,
                "total_tracks": album.get("nb_tracks") or len(tracks),
                "tracks": tracks,
            })

        _cache_set("deezer", q, results)
        return results


MB_HEADERS = {"User-Agent": "Pressd/1.0 (music-rating-app)"}


@router.get("/mb")
async def search_mb(q: str = Query(..., min_length=1)):
    """MusicBrainz release-group search.

    Release groups are album-level entities (one entry per record instead of
    one per edition) and carry first-release-date — which can be in the
    future, so announced-but-unreleased albums are findable here before any
    streaming service has them. Those are flagged `upcoming` for the UI.
    """
    cached = _cache_get("mb", q)
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=10, headers=MB_HEADERS) as client:
        escaped = q.replace('"', '\\"')
        search_resp = await client.get(
            "https://musicbrainz.org/ws/2/release-group/",
            params={
                "query": f'releasegroup:"{escaped}" OR artist:"{escaped}"',
                "fmt": "json",
                "limit": 8,
            },
        )
        if not search_resp.is_success:
            raise HTTPException(status_code=502, detail="MusicBrainz search failed")

        groups = [
            g for g in search_resp.json().get("release-groups", [])
            if g.get("primary-type") != "Single"
        ][:5]
        if not groups:
            _cache_set("mb", q, [])
            return []

        today = date.today().isoformat()
        results = []
        for rg in groups:
            credits = rg.get("artist-credit", [])
            artist = credits[0].get("name", "") if credits else ""

            frd = rg.get("first-release-date", "") or ""
            year = int(frd[:4]) if len(frd) >= 4 else None
            # Pad partial dates ("2026", "2026-09") to a comparable YYYY-MM-DD
            padded = (frd + "-01-01")[:10] if frd else ""
            upcoming = bool(padded and padded > today)

            # Tracklist from a representative release (prefer Official).
            # Announced albums may have a release with a tracklist long before
            # streaming services list them; some have no tracks yet — still
            # returned, since manual/partial import is better than not found.
            tracks = []
            releases = rg.get("releases") or []
            rel_id = next(
                (r["id"] for r in releases if (r.get("status") or "") == "Official"),
                releases[0]["id"] if releases else None,
            )
            if rel_id:
                await asyncio.sleep(0.25)  # stay under MB's ~1 req/s limit
                detail_resp = await client.get(
                    f"https://musicbrainz.org/ws/2/release/{rel_id}",
                    params={"inc": "recordings", "fmt": "json"},
                )
                if detail_resp.is_success:
                    global_pos = 0
                    for medium in detail_resp.json().get("media", []):
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

            # Cover art at the release-group level (HEAD avoids the download)
            cover_url = None
            try:
                await asyncio.sleep(0.1)
                caa = await client.head(
                    f"https://coverartarchive.org/release-group/{rg['id']}/front-250",
                    follow_redirects=True,
                    timeout=4,
                )
                if caa.status_code == 200:
                    cover_url = str(caa.url)
            except Exception:
                pass

            results.append({
                "spotify_id": None,
                "mb_id": rg["id"],
                "album_name": rg.get("title", ""),
                "artist": artist,
                "year": year,
                "release_date": frd or None,
                "upcoming": upcoming,
                "cover_url": cover_url,
                "total_tracks": len(tracks),
                "tracks": tracks,
            })

        _cache_set("mb", q, results)
        return results
