"""
The For You "New & Popular" list: this week's releases, ranked by how many
people are listening to each record.

What it used to be, and why it changed. albumoftheyear.org's this-week page was
the source, ordered by how many users had rated each release. Since at least
2026-09-15 AOTY answers every automated request with a Cloudflare challenge
("Just a moment…", HTTP 403, `cf-mitigated: challenge`) — from a residential
connection and with a browser User-Agent alike. It offers no API, and the
challenge is a deliberate choice, so this code does not try to get past it.
The ListenBrainz fallback then carried the feed, and carried it badly: it
sampled 24 of the week's ~700 albums at random and ranked them by the artist's
total Deezer fans. In the week of 2026-09-26 production showed Kärbholz,
Blitzkid and HORSKH while AOTY's top two were Tinashe and Taylor Swift.

How it is built now:
  1. AOTY, still first. One request; if the block ever lifts, its ordering is
     the real thing.
  2. Otherwise every album and EP ListenBrainz knows of from the last 7 days,
     plus Apple Music's most-played albums released in that window — which
     catches the biggest records before MusicBrainz lists them (Taylor Swift's
     *The Encore* was missing from ListenBrainz that week) — ranked by the
     Last.fm listener count of *that album*. Last.fm's audience overlaps AOTY's
     far more than any fan count does, and it measures the record rather than
     how famous the act is.
  Scored against AOTY's own archived lists for the weeks of 2026-09-12, -19 and
  -26: 11, 12 and 11 of our top 12 appear on AOTY's list, against 0–3 for the
  old fallback. ListenBrainz's own `listen_count` was 0 for every fresh release,
  so it cannot do this job.

That is ~1,000 Last.fm lookups, paced under its 5-a-second limit — about three
and a half minutes, far too slow for a page request. So worker/refresh_new_releases.py
builds the list every 6 hours in GitHub Actions and stores it in `cachedfeed`,
and the web endpoint only reads it. `quick_build` is the endpoint's last resort
when no stored list exists: Apple's most-played recent releases, which are
recognisable by construction, padded with Deezer's album chart.

No FastAPI in here: the worker imports it, and its requirements carry none.
"""
import asyncio
import html as _html
import json
import re
import time
from datetime import date, datetime, timedelta

import httpx
from sqlmodel import Session

from .models import CachedFeed
from .trackkeys import same_album

DEEZER_BASE = "https://api.deezer.com"
LISTENBRAINZ_FRESH = "https://api.listenbrainz.org/1/explore/fresh-releases/"
APPLE_MOST_PLAYED = "https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/albums.json"
LASTFM_API = "https://ws.audioscrobbler.com/2.0/"
UA = "Pressd/1.0 (https://www.pressdmusic.com)"

FEED_KEY = "new_releases"
MAX_RELEASES = 30          # the endpoint's `limit` ceiling
WINDOW_DAYS = 7
LASTFM_PER_SECOND = 4.5    # Last.fm allows 5/s averaged over five minutes
# A ranking only means something if Last.fm answered. Fewer records with any
# listeners than this is an outage, not a quiet week — fail, and keep serving
# the last good list, rather than store an arbitrary order.
MIN_RANKED = 12


class NoReleases(RuntimeError):
    """Nothing usable came back from any source."""


# ── small helpers ─────────────────────────────────────────────────────────────

def cover(a: dict) -> str | None:
    return a.get("cover_xl") or a.get("cover_big") or a.get("cover_medium") or None


def year(release_date: str | None) -> int | None:
    return int(release_date[:4]) if release_date and release_date[:4].isdigit() else None


def _caa_cover(r: dict) -> str | None:
    cid, mbid = r.get("caa_id"), r.get("caa_release_mbid")
    return f"https://coverartarchive.org/release/{mbid}/{cid}-500.jpg" if cid and mbid else None


class _Pacer:
    """At most `rate` request starts a second across every coroutine sharing it."""

    def __init__(self, rate: float):
        self.gap, self.next, self.lock = 1.0 / rate, 0.0, asyncio.Lock()

    async def wait(self):
        async with self.lock:
            now = time.monotonic()
            if self.next > now:
                await asyncio.sleep(self.next - now)
            self.next = max(now, self.next) + self.gap


# ── albumoftheyear.org (formerly backend/aoty_releases.py) ─────────────────────
# No public API, so this parses the one listing page, /releases/this-week/. That
# path is not disallowed by AOTY's robots.txt (which blocks search, user, tag and
# ?sort= paths), the request identifies itself honestly as Pressd, and it is one
# page fetch per refresh. Being HTML it is fragile: `parse_releases` returns []
# on markup it doesn't recognise, so a layout change degrades to the Last.fm
# ranking rather than failing. Since 2026-09 every request meets a Cloudflare
# challenge, so in practice this returns [] — see the module docstring.

AOTY_THIS_WEEK = "https://www.albumoftheyear.org/releases/this-week/"
AOTY_UA = "Pressd/1.0 (+https://www.pressdmusic.com)"

# One <div class="albumBlock ..."> per release; non-greedy up to the next block.
_BLOCK = re.compile(r'<div class="albumBlock[^"]*"[^>]*>(.*?)(?=<div class="albumBlock|\Z)', re.S)
_ALBUM_HREF = re.compile(r'href="(/album/(\d+)-[^"]*)"')
_COVER = re.compile(r'<img src="([^"]+)"')
_ARTIST = re.compile(r'<div class="artistTitle">(.*?)</div>', re.S)
_TITLE = re.compile(r'<div class="albumTitle">(.*?)</div>', re.S)
# Each ratingRow is a score plus its label and sample size:
#   <div class="rating">70</div> ... user score ... (10.4K)
_RATING_ROW = re.compile(
    r'<div class="rating">(\d+)</div>.*?<div class="ratingText">([^<]*?)</div>\s*'
    r'<div class="ratingText">\((.*?)\)</div>',
    re.S,
)


def _text(raw: str) -> str:
    """Strip tags and decode entities. Accented titles ("Memórias Póstumas")
    arrive as named entities, so this uses the stdlib table rather than a
    hand-rolled one."""
    return _html.unescape(re.sub(r"<[^>]+>", "", raw)).strip()


def _count(raw: str) -> int:
    """'10.4K' -> 10400, '1.2M' -> 1200000, '31' -> 31, anything else -> 0."""
    s = _text(raw).replace(",", "").strip().upper()
    m = re.match(r"^([\d.]+)([KM]?)$", s)
    if not m:
        return 0
    n = float(m.group(1))
    return int(n * {"": 1, "K": 1_000, "M": 1_000_000}[m.group(2)])


def parse_releases(html: str) -> list[dict]:
    """Releases from a this-week listing page, most-rated first."""
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for raw in _BLOCK.findall(html):
        href = _ALBUM_HREF.search(raw)
        artist = _ARTIST.search(raw)
        title = _TITLE.search(raw)
        if not (href and artist and title):
            continue
        artist_name, album_name = _text(artist.group(1)), _text(title.group(1))
        if not artist_name or not album_name:
            continue
        key = (album_name.lower(), artist_name.lower())
        if key in seen:
            continue
        seen.add(key)

        critic_score = critic_n = user_score = user_n = None
        for score, label, count in _RATING_ROW.findall(raw):
            label = _text(label).lower()
            if "critic" in label:
                critic_score, critic_n = int(score), _count(count)
            elif "user" in label:
                user_score, user_n = int(score), _count(count)

        img = _COVER.search(raw)
        out.append({
            "aoty_id": int(href.group(2)),
            "aoty_url": f"https://www.albumoftheyear.org{href.group(1)}",
            "album_name": album_name,
            "artist": artist_name,
            # Ask the CDN for a larger crop than the 200px thumbnail in the page.
            "cover_url": img.group(1).replace("/200x0/", "/400x0/") if img else None,
            "critic_score": critic_score,
            "critic_count": critic_n,
            "user_score": user_score,
            "user_count": user_n or 0,
        })

    # Popularity = how many people bothered to rate this release this week.
    out.sort(key=lambda r: (r["user_count"], r["critic_count"] or 0), reverse=True)
    return out


async def _get_json(client: httpx.AsyncClient, what: str, url: str, **kw) -> dict | None:
    """GET a JSON source, retrying once: one network blip should not cost a
    source for the six hours until the next refresh. Logs the exception *type*,
    because httpx timeouts often carry an empty message."""
    for attempt in (1, 2):
        try:
            resp = await client.get(url, headers={"User-Agent": UA}, **kw)
            if resp.is_success:
                return resp.json()
            print(f"[new-releases] {what} answered HTTP {resp.status_code} (attempt {attempt})")
        except (httpx.HTTPError, ValueError) as e:
            print(f"[new-releases] {what} failed (attempt {attempt}): {type(e).__name__} {e}")
        if attempt == 1:
            await asyncio.sleep(3)
    return None


# ── sources ───────────────────────────────────────────────────────────────────

async def aoty_this_week(client: httpx.AsyncClient) -> list[dict]:
    """AOTY's this-week listing, most-rated first; [] on any failure."""
    try:
        resp = await client.get(AOTY_THIS_WEEK, headers={"User-Agent": AOTY_UA})
    except httpx.HTTPError as e:
        print(f"[new-releases] AOTY unreachable: {e}")
        return []
    if not resp.is_success:
        # Expected since 2026-09 (Cloudflare challenge); logged so a change shows.
        print(f"[new-releases] AOTY answered HTTP {resp.status_code}")
        return []
    try:
        return parse_releases(resp.text)
    except Exception as e:  # markup drifted — degrade instead of failing
        print(f"[new-releases] AOTY parse failed: {e}")
        return []


async def listenbrainz_candidates(client: httpx.AsyncClient, days: int = WINDOW_DAYS) -> list[dict]:
    """Every album and EP released in the window that MusicBrainz knows of."""
    body = await _get_json(client, "ListenBrainz", LISTENBRAINZ_FRESH,
                           params={"days": days, "sort": "release_date", "past": "true", "future": "false"})
    out = []
    for r in (body or {}).get("payload", {}).get("releases", []):
        title, artist = r.get("release_name"), r.get("artist_credit_name")
        if title and artist and r.get("release_group_primary_type") in ("Album", "EP"):
            out.append({"album_name": title, "artist": artist,
                        "release_date": r.get("release_date"), "cover_url": _caa_cover(r)})
    return out


async def apple_candidates(client: httpx.AsyncClient, days: int = WINDOW_DAYS) -> list[dict]:
    """Apple Music's 100 most-played albums, kept only if released in the window,
    in Apple's play order."""
    body = await _get_json(client, "Apple feed", APPLE_MOST_PLAYED)
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    out = []
    for a in (body or {}).get("feed", {}).get("results", []):
        rd = a.get("releaseDate") or ""
        if a.get("name") and a.get("artistName") and rd >= cutoff:
            out.append({"album_name": a["name"], "artist": a["artistName"], "release_date": rd,
                        "cover_url": (a.get("artworkUrl100") or "").replace("100x100", "600x600") or None})
    return out


async def _deezer_chart(client: httpx.AsyncClient) -> list[dict]:
    body = await _get_json(client, "Deezer chart", f"{DEEZER_BASE}/chart/0/albums", params={"limit": 50})
    items = (body or {}).get("data", [])
    return [{"album_name": a["title"], "artist": (a.get("artist") or {}).get("name"),
             "release_date": a.get("release_date"), "cover_url": cover(a)}
            for a in items if a.get("title") and (a.get("artist") or {}).get("name")]


def _merge(*lists: list[dict]) -> list[dict]:
    """Concatenate, dropping any record already present under another spelling."""
    out: list[dict] = []
    for lst in lists:
        for c in lst:
            if not any(same_album(c["album_name"], c["artist"], o["album_name"], o["artist"]) for o in out):
                out.append(c)
    return out


# ── ranking and resolution ────────────────────────────────────────────────────

async def lastfm_listeners(client: httpx.AsyncClient, pacer: _Pacer, key: str,
                           artist: str, album: str) -> int:
    """Listeners of this album on Last.fm; 0 when it is unknown there."""
    params = {"method": "album.getinfo", "artist": artist, "album": album,
              "api_key": key, "format": "json", "autocorrect": 1}
    for attempt in range(3):
        await pacer.wait()
        try:
            resp = await client.get(LASTFM_API, params=params, headers={"User-Agent": UA})
        except httpx.HTTPError:
            continue
        if resp.status_code == 404:           # "Album not found"
            return 0
        if resp.status_code == 429 or resp.status_code >= 500:
            await asyncio.sleep(2 * (attempt + 1))
            continue
        try:
            body = resp.json()
        except ValueError:
            return 0
        if body.get("error") in (8, 11, 16, 29):   # transient, or rate limited
            await asyncio.sleep(2 * (attempt + 1))
            continue
        if body.get("error") or not resp.is_success:
            return 0
        return int((body.get("album") or {}).get("listeners") or 0)
    return 0


async def deezer_resolve(client: httpx.AsyncClient, sem: asyncio.Semaphore,
                         title: str, artist: str) -> dict | None:
    """Match a release to a Deezer album for the importable id + cover.

    Scans a page of hits rather than only the first: Deezer frequently ranks a
    single or a lead track above the album itself, so the record we want is
    often the second or third result.
    """
    try:
        async with sem:
            resp = await client.get(f"{DEEZER_BASE}/search/album",
                                    params={"q": f"{artist} {title}", "limit": 10})
    except httpx.HTTPError:
        return None
    if not resp.is_success:
        return None
    body = resp.json()
    if body.get("error"):  # Deezer returns HTTP 200 + an error body when rate-limited
        return None
    for a in body.get("data", []):
        if not a.get("id"):
            continue
        # The hit has to be the same record, not just something Deezer ranked
        # highly for the query: a different album by the right artist is as
        # wrong as a same-titled album by someone else.
        dz_artist = (a.get("artist") or {}).get("name") or ""
        if same_album(title, artist, a.get("title") or "", dz_artist):
            return {"deezer_id": a["id"], "cover_url": cover(a), "nb_tracks": a.get("nb_tracks")}
    return None


async def _resolve_in_order(client: httpx.AsyncClient, ranked: list[dict], limit: int) -> list[dict]:
    """Deezer ids for the ranked list, keeping its order. A record Deezer doesn't
    carry has no tracklist and nothing to rate, so it is dropped, not shown as a
    dead end — hence the spares."""
    sem = asyncio.Semaphore(10)  # stays under Deezer's ~50 requests / 5 s
    top = ranked[:limit + 15]
    found = await asyncio.gather(*[deezer_resolve(client, sem, c["album_name"], c["artist"]) for c in top])
    out = []
    for c, dz in zip(top, found):
        if not dz:
            continue
        out.append({
            "deezer_id": dz["deezer_id"],
            "album_name": c["album_name"],
            "artist": c["artist"],
            "cover_url": c.get("cover_url") or dz["cover_url"],
            "year": year(c.get("release_date")),
            "release_date": c.get("release_date"),
            "nb_tracks": dz["nb_tracks"],
            "rater_count": c.get("user_count"),     # AOTY only
            "user_score": c.get("user_score"),
            "critic_score": c.get("critic_score"),
            "listeners": c.get("listeners"),        # Last.fm only
        })
        if len(out) == limit:
            break
    return out


async def build(lastfm_key: str | None, limit: int = MAX_RELEASES) -> tuple[list[dict], str]:
    """The full list and which source produced it ('aoty' or 'lastfm'). Slow —
    run it from the worker, not a request. Raises NoReleases rather than return
    something too thin to be worth storing."""
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        aoty = await aoty_this_week(client)
        if aoty:
            out = await _resolve_in_order(client, aoty, limit)
            if len(out) >= MIN_RANKED:
                return out, "aoty"

        if not lastfm_key:
            raise NoReleases("LASTFM_API_KEY is not set")
        lb, apple = await asyncio.gather(listenbrainz_candidates(client), apple_candidates(client))
        candidates = _merge(apple, lb)
        if not candidates:
            raise NoReleases("ListenBrainz and Apple returned nothing")

        pacer, sem = _Pacer(LASTFM_PER_SECOND), asyncio.Semaphore(8)

        async def listeners(c):
            async with sem:
                c["listeners"] = await lastfm_listeners(client, pacer, lastfm_key, c["artist"], c["album_name"])

        started = time.monotonic()
        await asyncio.gather(*[listeners(c) for c in candidates])
        ranked = sorted((c for c in candidates if c["listeners"]), key=lambda c: c["listeners"], reverse=True)
        print(f"[new-releases] {len(candidates)} candidates ({len(apple)} from Apple), "
              f"{len(ranked)} known to Last.fm, {time.monotonic() - started:.0f}s")
        if len(ranked) < MIN_RANKED:
            raise NoReleases(f"only {len(ranked)} releases had Last.fm listeners — Last.fm is likely failing")

        out = await _resolve_in_order(client, ranked, limit)
        if len(out) < MIN_RANKED:
            raise NoReleases(f"only {len(out)} ranked releases resolved on Deezer")
        return out, "lastfm"


async def quick_build(limit: int = MAX_RELEASES) -> list[dict]:
    """A few seconds' worth, for a request that finds no stored list: Apple's
    most-played releases from the last two weeks, padded with Deezer's chart."""
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        apple, chart = await asyncio.gather(apple_candidates(client, days=14), _deezer_chart(client))
        out = await _resolve_in_order(client, _merge(apple, chart), limit)
    if not out:
        raise NoReleases("Apple and Deezer returned nothing resolvable")
    return out


# ── the stored copy ───────────────────────────────────────────────────────────

def read_stored(session: Session) -> tuple[list[dict], float] | None:
    """(releases, age in seconds) from `cachedfeed`, or None. Never raises: the
    stored copy is an optimisation, so a database hiccup costs one slow request,
    not a failed one."""
    try:
        row = session.get(CachedFeed, FEED_KEY)
        if row is None:
            return None
        releases = json.loads(row.payload_json)
        if not releases:
            return None
        # Clamped: fetched_at was stamped by whichever machine wrote it, and a
        # clock behind this one must not read as a list from the future.
        return releases, max(0.0, (datetime.utcnow() - row.fetched_at).total_seconds())
    except Exception as e:
        session.rollback()
        print(f"[new-releases] stored copy unreadable: {e}")
        return None


def write_stored(session: Session, releases: list[dict]) -> None:
    """Replace the stored copy. Raises — callers decide whether that matters: the
    worker must fail loudly, the endpoint shrugs it off."""
    row = session.get(CachedFeed, FEED_KEY) or CachedFeed(key=FEED_KEY, payload_json="")
    row.payload_json = json.dumps(releases)
    row.fetched_at = datetime.utcnow()
    session.add(row)
    session.commit()
