"""Album search and resolution.

Search is deliberately split in two phases:

  1. `/search/{itunes,deezer,mb}` return *identity only* — name, artist, year,
     cover, track count. One HTTP call per source, no per-album detail fetches.
     These back the autocomplete, so they have to be fast on every keystroke.
  2. `/search/resolve` fetches the full tracklist for the single album the user
     actually picked.

Before the split, each source fetched a tracklist for every one of its 5–8
results during search (~7 sequential calls per source per keystroke), which is
what made Deezer ~2s and MusicBrainz 10–18s in production.

Spotify was removed: the client-credentials app has been returning
429 QUOTA_EXCEEDED with `Retry-After: 86400` on every endpoint, and zero of the
819 albums in the database ever carried a Spotify id. The dead source's results
were silently falling back to an iTunes search on the literal string
"album:<query>", which is where the unrelated top-chart results came from.
"""
import asyncio
import os
import time
from datetime import date

import httpx
from fastapi import APIRouter, Body, HTTPException, Query

router = APIRouter(prefix="/search", tags=["search"])

# ── Result cache ──────────────────────────────────────────────────────────────
# In-process TTL cache keyed by (kind, normalized key). Repeat searches are
# instant and the outbound APIs are protected — MusicBrainz in particular is
# globally rate-limited to ~1 req/s, so cache misses must be the exception.
_CACHE_TTL = 600  # seconds
_CACHE_MAX = 500
_cache: dict[str, tuple[float, object]] = {}


def _cache_get(kind: str, key: str):
    entry = _cache.get(f"{kind}:{key.strip().lower()}")
    if entry and entry[0] > time.monotonic():
        return entry[1]
    return None


def _cache_set(kind: str, key: str, data) -> None:
    if len(_cache) >= _CACHE_MAX:
        for k, _ in sorted(_cache.items(), key=lambda kv: kv[1][0])[: _CACHE_MAX // 2]:
            _cache.pop(k, None)
    _cache[f"{kind}:{key.strip().lower()}"] = (time.monotonic() + _CACHE_TTL, data)


def _year(release_date: str | None) -> int | None:
    if not release_date or len(release_date) < 4:
        return None
    try:
        return int(release_date[:4])
    except ValueError:
        return None


MB_HEADERS = {"User-Agent": "Pressd/1.0 (music-rating-app)"}
CAA_BASE = "https://coverartarchive.org"


# ── Search: identity only ─────────────────────────────────────────────────────

@router.get("/itunes")
async def search_itunes(q: str = Query(..., min_length=1)):
    cached = _cache_get("itunes", q)
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            "https://itunes.apple.com/search",
            params={"term": q, "entity": "album", "limit": 8},
        )
        if not resp.is_success:
            raise HTTPException(status_code=502, detail="iTunes search failed")

        results = []
        for a in resp.json().get("results", []):
            collection_id = a.get("collectionId")
            if not collection_id:
                continue
            cover = a.get("artworkUrl100", "").replace("100x100bb", "1000x1000bb") or None
            results.append({
                "source": "itunes",
                "source_id": str(collection_id),
                "spotify_id": None,
                "album_name": a.get("collectionName", ""),
                "artist": a.get("artistName", ""),
                "year": _year(a.get("releaseDate")),
                "cover_url": cover,
                "total_tracks": a.get("trackCount"),
                "genre": a.get("primaryGenreName"),
            })

    _cache_set("itunes", q, results)
    return results


async def _deezer_fill_dates(client: httpx.AsyncClient, results: list[dict]) -> None:
    """Fill release dates on Deezer search results.

    Deezer's `/search/album` payload has no release date at all — every row came
    back yearless, which left the dropdown unable to tell two same-titled albums
    apart. The dates live on the album records, so they're fetched one request
    per result, concurrently (~300ms for a full page) and memoized per album id
    so overlapping results across keystrokes cost nothing.
    """
    async def one(r: dict) -> None:
        aid = r["source_id"]
        cached = _cache_get("dz_date", aid)
        if cached is not None:
            r["release_date"], r["year"] = cached or None, _year(cached)
            return
        try:
            resp = await client.get(f"https://api.deezer.com/album/{aid}", timeout=8)
            if not resp.is_success:
                return
            body = resp.json()
            if body.get("error"):  # Deezer answers 200 + error body when throttled
                return
            date = body.get("release_date") or ""
        except Exception:
            return  # a missing year is recoverable; a failed search is not
        _cache_set("dz_date", aid, date)
        r["release_date"], r["year"] = date or None, _year(date)

    await asyncio.gather(*[one(r) for r in results])


@router.get("/deezer")
async def search_deezer(q: str = Query(..., min_length=1)):
    cached = _cache_get("deezer", q)
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=12) as client:
        resp = await client.get(
            "https://api.deezer.com/search/album",
            params={"q": q, "limit": 8},
        )
        if not resp.is_success:
            raise HTTPException(status_code=502, detail="Deezer search failed")

        results = []
        for a in resp.json().get("data", []):
            album_id = a.get("id")
            if not album_id:
                continue
            cover = a.get("cover_xl") or a.get("cover_big") or a.get("cover_medium") or None
            results.append({
                "source": "deezer",
                "source_id": str(album_id),
                "spotify_id": None,
                "album_name": a.get("title", ""),
                "artist": (a.get("artist") or {}).get("name", ""),
                "year": None,
                "release_date": None,
                "cover_url": cover,
                "total_tracks": a.get("nb_tracks"),
            })

        await _deezer_fill_dates(client, results)

    _cache_set("deezer", q, results)
    return results


@router.get("/mb")
async def search_mb(q: str = Query(..., min_length=1)):
    """MusicBrainz release-group search.

    Release groups are album-level entities (one entry per record instead of
    one per edition) and carry first-release-date — which can be in the
    future, so announced-but-unreleased albums are findable here before any
    streaming service has them. Those are flagged `upcoming` for the UI.

    Cover lookups run concurrently against the Cover Art Archive (a separate
    host from the MB API, so MB's ~1 req/s courtesy limit doesn't apply); the
    tracklist is left to `/search/resolve`.
    """
    cached = _cache_get("mb", q)
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=10, headers=MB_HEADERS) as client:
        escaped = q.replace('"', '\\"')
        resp = await client.get(
            "https://musicbrainz.org/ws/2/release-group/",
            params={
                "query": f'releasegroup:"{escaped}" OR artist:"{escaped}"',
                "fmt": "json",
                "limit": 8,
            },
        )
        if not resp.is_success:
            raise HTTPException(status_code=502, detail="MusicBrainz search failed")

        # Undated release groups are dropped. MusicBrainz genuinely has no date
        # for these (the detail endpoint returns an empty first-release-date
        # too), and a yearless result is unusable here: the year drives the
        # dropdown's disambiguation and every year-based stat downstream. It
        # also can't be the announced/unreleased album MB is carried for —
        # `upcoming` is derived from that very date.
        groups = [
            g for g in resp.json().get("release-groups", [])
            if g.get("primary-type") != "Single" and (g.get("first-release-date") or "")
        ][:6]
        if not groups:
            _cache_set("mb", q, [])
            return []

        async def cover(rg_id: str) -> str | None:
            try:
                r = await client.head(
                    f"{CAA_BASE}/release-group/{rg_id}/front-250",
                    follow_redirects=True,
                    timeout=4,
                )
                return str(r.url) if r.status_code == 200 else None
            except Exception:
                return None

        covers = await asyncio.gather(*[cover(g["id"]) for g in groups])

        today = date.today().isoformat()
        results = []
        for rg, cover_url in zip(groups, covers):
            credits = rg.get("artist-credit", [])
            frd = rg.get("first-release-date", "") or ""
            # Pad partial dates ("2026", "2026-09") to a comparable YYYY-MM-DD
            padded = (frd + "-01-01")[:10] if frd else ""
            results.append({
                "source": "mb",
                "source_id": rg["id"],
                "spotify_id": None,
                "mb_id": rg["id"],
                "album_name": rg.get("title", ""),
                "artist": credits[0].get("name", "") if credits else "",
                "year": _year(frd),
                "release_date": frd or None,
                "upcoming": bool(padded and padded > today),
                "cover_url": cover_url,
                "total_tracks": None,
            })

    _cache_set("mb", q, results)
    return results


# ── Resolve: the picked album's full tracklist ────────────────────────────────

async def _resolve_itunes(client: httpx.AsyncClient, collection_id: str) -> dict:
    resp = await client.get(
        "https://itunes.apple.com/lookup",
        params={"id": collection_id, "entity": "song"},
    )
    if not resp.is_success:
        raise HTTPException(status_code=502, detail="iTunes lookup failed")
    items = resp.json().get("results", [])
    album = next((i for i in items if i.get("wrapperType") == "collection"), None)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found on iTunes")

    artist = album.get("artistName", "")
    tracks = [
        {
            "title": t["trackName"],
            "track_number": t.get("trackNumber"),
            "duration_ms": t.get("trackTimeMillis"),
            "explicit": t.get("trackExplicitness") == "explicit",
            "spotify_id": None,
            "artist": t.get("artistName", artist),
        }
        for t in items
        if t.get("wrapperType") == "track" and t.get("kind") == "song" and t.get("trackName")
    ]
    return {
        "spotify_id": None,
        "album_name": album.get("collectionName", ""),
        "artist": artist,
        "year": _year(album.get("releaseDate")),
        "cover_url": album.get("artworkUrl100", "").replace("100x100bb", "1000x1000bb") or None,
        "total_tracks": album.get("trackCount", len(tracks)),
        "genre": album.get("primaryGenreName"),
        "tracks": tracks,
    }


async def _resolve_deezer(client: httpx.AsyncClient, album_id: str) -> dict:
    resp = await client.get(f"https://api.deezer.com/album/{album_id}")
    if not resp.is_success:
        raise HTTPException(status_code=404, detail="Album not found on Deezer")
    album = resp.json()

    tracks_data = (album.get("tracks") or {}).get("data")
    if tracks_data is None:
        tr = await client.get(
            f"https://api.deezer.com/album/{album_id}/tracks", params={"limit": 100}
        )
        tracks_data = tr.json().get("data", []) if tr.is_success else []

    artist = (album.get("artist") or {}).get("name", "")
    tracks = [
        {
            "title": t.get("title", ""),
            "track_number": t.get("track_position") or i + 1,
            "duration_ms": (t.get("duration") or 0) * 1000,
            "explicit": t.get("explicit_lyrics", False),
            "spotify_id": None,
            "artist": (t.get("artist") or {}).get("name", "") or artist,
        }
        for i, t in enumerate(tracks_data)
    ]
    return {
        "spotify_id": None,
        "album_name": album.get("title", ""),
        "artist": artist,
        "year": _year(album.get("release_date")),
        "cover_url": album.get("cover_xl") or album.get("cover_big") or album.get("cover_medium"),
        "total_tracks": album.get("nb_tracks") or len(tracks),
        "genre": ((album.get("genres") or {}).get("data") or [{}])[0].get("name"),
        "tracks": tracks,
    }


async def _resolve_mb(client: httpx.AsyncClient, rg_id: str) -> dict:
    """Tracklist from a representative release of the group (prefer Official).

    Announced albums may have a release with a tracklist long before streaming
    services list them; some have none yet — still returned, since a manual or
    partial import beats "not found".
    """
    resp = await client.get(
        f"https://musicbrainz.org/ws/2/release-group/{rg_id}",
        params={"inc": "releases+artist-credits", "fmt": "json"},
    )
    if not resp.is_success:
        raise HTTPException(status_code=404, detail="Release group not found on MusicBrainz")
    rg = resp.json()

    credits = rg.get("artist-credit", [])
    artist = credits[0].get("name", "") if credits else ""
    frd = rg.get("first-release-date", "") or ""

    releases = rg.get("releases") or []
    rel_id = next(
        (r["id"] for r in releases if (r.get("status") or "") == "Official"),
        releases[0]["id"] if releases else None,
    )

    tracks = []
    if rel_id:
        await asyncio.sleep(0.25)  # stay under MB's ~1 req/s limit
        detail = await client.get(
            f"https://musicbrainz.org/ws/2/release/{rel_id}",
            params={"inc": "recordings", "fmt": "json"},
        )
        if detail.is_success:
            pos = 0
            for medium in detail.json().get("media", []):
                for t in medium.get("tracks", []):
                    pos += 1
                    tracks.append({
                        "title": t.get("title", ""),
                        "track_number": t.get("position") or pos,
                        "duration_ms": t.get("length"),
                        "explicit": False,
                        "spotify_id": None,
                        "artist": artist,
                    })

    cover_url = None
    try:
        caa = await client.head(
            f"{CAA_BASE}/release-group/{rg_id}/front-250", follow_redirects=True, timeout=4
        )
        if caa.status_code == 200:
            cover_url = str(caa.url)
    except Exception:
        pass

    today = date.today().isoformat()
    padded = (frd + "-01-01")[:10] if frd else ""
    return {
        "spotify_id": None,
        "mb_id": rg_id,
        "album_name": rg.get("title", ""),
        "artist": artist,
        "year": _year(frd),
        "release_date": frd or None,
        "upcoming": bool(padded and padded > today),
        "cover_url": cover_url,
        "total_tracks": len(tracks),
        "tracks": tracks,
    }


# ── Popularity ────────────────────────────────────────────────────────────────

LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/"
MAX_POPULARITY_ITEMS = 12


def _lastfm_key() -> str | None:
    """Env-only, no literal fallback, and read at call time rather than import
    time — `.env` is loaded by `backend.database`, which isn't guaranteed to
    have been imported first when a script pulls in this router directly.

    Unset means the popularity prior is unavailable and the ranker falls back to
    text similarity; search still works.
    """
    return os.environ.get("LASTFM_API_KEY")


@router.post("/popularity")
async def album_popularity(items: list[dict] = Body(...)):
    """Last.fm listener counts for a batch of albums, aligned to input order.

    Text similarity can't separate a famous album from an obscure one sharing
    its name — the band "Rumours" matches the query *Rumours* on both title and
    artist, beating Fleetwood Mac's. Listener counts separate those by four
    orders of magnitude, so the ranker uses them as a popularity prior.

    Runs server-side to keep the API key off the client. Unknown albums come
    back as 0, which the ranker treats as "no signal" rather than "unpopular".
    """
    items = items[:MAX_POPULARITY_ITEMS]
    if not items:
        return []
    api_key = _lastfm_key()
    if not api_key:
        return [0] * len(items)  # no key configured → no popularity signal

    async with httpx.AsyncClient(timeout=8) as client:
        async def one(it: dict) -> int:
            album = (it.get("album_name") or "").strip()
            artist = (it.get("artist") or "").strip()
            if not (album and artist):
                return 0
            cache_key = f"{album}|||{artist}".lower()
            cached = _cache_get("lastfm", cache_key)
            if cached is not None:
                return cached
            try:
                resp = await client.get(LASTFM_BASE, params={
                    "method": "album.getinfo", "api_key": api_key,
                    "artist": artist, "album": album,
                    "format": "json", "autocorrect": "1",
                })
                if resp.status_code != 200:
                    return 0
                body = resp.json()
                if "error" in body:  # 6 = "album not found", the common case
                    _cache_set("lastfm", cache_key, 0)
                    return 0
                count = int((body.get("album") or {}).get("listeners") or 0)
            except Exception:
                return 0  # popularity is a ranking hint, never a hard failure
            _cache_set("lastfm", cache_key, count)
            return count

        return await asyncio.gather(*[one(i) for i in items])


@router.get("/resolve")
async def resolve_album(
    source: str = Query(..., pattern="^(itunes|deezer|mb)$"),
    id: str = Query(..., min_length=1),
):
    """Full album + tracklist for one search result, in the shape
    `/albums/import` consumes. Called when the user picks a result, not while
    they type."""
    cached = _cache_get("resolve", f"{source}:{id}")
    if cached is not None:
        return cached

    headers = MB_HEADERS if source == "mb" else {}
    async with httpx.AsyncClient(timeout=15, headers=headers) as client:
        if source == "itunes":
            data = await _resolve_itunes(client, id)
        elif source == "deezer":
            data = await _resolve_deezer(client, id)
        else:
            data = await _resolve_mb(client, id)

    _cache_set("resolve", f"{source}:{id}", data)
    return data
