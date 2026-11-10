"""
Upcoming releases: records that are announced, dated, and not out yet — the
data behind the calendar that opens from For You's New & Popular section.

Where it comes from, and why (researched 2026-11-10, every source tried live):

  1. ListenBrainz fresh releases with `future=true` — the list. Every album, EP
     and single MusicBrainz editors have dated, with the release-group id, tags
     and a Cover Art Archive cover (about four in five). No key, CC0. Its window
     is at most 90 days, so a second request starts where the first ends. Of the
     191 notable releases Wikipedia listed for the next 90 days it had 111, with
     the same date on 110; it is strong on indie, metal and international
     records and thins out further ahead, because it is only as complete as
     MusicBrainz's editors make it.
  2. Wikipedia's "List of {year} albums" pages — what's notable, and what the
     list misses. Each row is a dated record with a cited announcement, edited
     daily, already running months ahead; an artist gets a row only with an
     article of their own (994 of 998 rows link one). A record on it is
     `notable`; one only on it (about 40% of notable releases) joins the list.
  3. Deezer, then iTunes — for notable records only: an importable Deezer id,
     the track count and a cover; iTunes (pre-orders) where Deezer has nothing.
     iTunes allows about 20 requests a minute, which is why it goes second.
  4. Last.fm — each artist's listener count, so a calendar day can be ordered
     by how many people care, and the second way to be notable: an album or EP
     (not a live album, compilation and the like) by an artist with at least
     NOTABLE_LISTENERS. Wikipedia alone missed 13 such records on 2026-11-10 —
     Stray Kids' SUIATSU among them, over a million listeners — and the rule adds
     nothing obscure. `notable_by` says which rule (wikipedia first). A
     not-yet-released album has no album listeners, hence the artist's.

Ruled out in the same research: Genius's release calendar (a community-edited
page behind a Cloudflare challenge even from a residential connection, and
sparse), Spotify (no upcoming data; new releases closed to small apps in 2026),
AOTY / RateYourMusic / AllMusic (Cloudflare), Reddit (login wall), Apple's old
"coming soon" feeds (gone). Bandcamp's undocumented discover endpoint has indie
pre-orders and is left out until it is worth depending on something that can
vanish without notice.

All of it is minutes of paced requests, so worker/refresh_upcoming_releases.py
builds it daily in GitHub Actions and stores it in `cachedfeed`; the endpoint
(`GET /discover/upcoming`) only reads and filters it.

No FastAPI in here: the worker imports it, and its requirements carry none.
"""
import asyncio
import html as _html
import json
import re
import time
from collections import Counter
from datetime import date, datetime, timedelta

import httpx
from sqlmodel import Session

from .models import CachedFeed
from .new_releases import DEEZER_BASE, LASTFM_API, UA, _Pacer, _caa_cover, cover as _dz_cover
from .trackkeys import _clean_album, artist_key, artist_matches, same_album, subject_key_album

FEED_KEY = "upcoming_releases"
LISTENBRAINZ_FRESH = "https://api.listenbrainz.org/1/explore/fresh-releases/"
WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
ITUNES_SEARCH = "https://itunes.apple.com/search"

HORIZON_DAYS = 180         # how far ahead the stored list reaches
LB_WINDOW = 90             # ListenBrainz's own maximum per request
LASTFM_PER_SECOND = 4.5    # Last.fm allows 5/s averaged over five minutes
ITUNES_PER_SECOND = 0.3    # Apple documents about 20 calls a minute
DEEZER_PER_SECOND = 6      # Deezer allows about 50 requests in 5 seconds
# Below these the source is down or has changed shape, not quiet: fail and keep
# serving the last good list rather than store a thin one.
MIN_LISTENBRAINZ = 100
MIN_WIKIPEDIA = 30

TYPES = {"Album": "album", "EP": "ep", "Single": "single"}
# An album or EP by an artist this big is notable even off Wikipedia's list
# (Jack's choice, 2026-11-10: Wikipedia plus this rule). 250,000 would have
# added 28 records that day instead of 13.
NOTABLE_LISTENERS = 500_000

# How the last build went, source by source — the worker stores it with the run.
LAST_TALLY: dict[str, int] = {}


class NoUpcoming(RuntimeError):
    """A source came back too thin to store a list built on it."""


async def _get_json(client: httpx.AsyncClient, what: str, url: str, **kw) -> dict | None:
    """GET JSON, retrying once; None on failure. Logs the exception type, since
    httpx timeouts often carry an empty message."""
    for attempt in (1, 2):
        try:
            resp = await client.get(url, headers={"User-Agent": UA}, **kw)
            if resp.is_success:
                return resp.json()
            print(f"[upcoming] {what} answered HTTP {resp.status_code} (attempt {attempt})")
        except (httpx.HTTPError, ValueError) as e:
            print(f"[upcoming] {what} failed (attempt {attempt}): {type(e).__name__} {e}")
        if attempt == 1:
            await asyncio.sleep(3)
    return None


# ── ListenBrainz ──────────────────────────────────────────────────────────────

def parse_listenbrainz(releases: list[dict]) -> list[dict]:
    """One row per release group (a record's editions share one), albums, EPs and
    singles only. `secondary` keeps MusicBrainz's live / compilation / soundtrack
    / remix / demo, so the page can leave those out."""
    out, seen = [], set()
    for r in releases:
        kind = TYPES.get(r.get("release_group_primary_type") or "")
        title, artist, day = r.get("release_name"), r.get("artist_credit_name"), r.get("release_date")
        group = r.get("release_group_mbid") or r.get("release_mbid")
        if not (kind and title and artist and day) or group in seen:
            continue
        seen.add(group)
        out.append({
            "release_date": day[:10], "artist": artist, "title": title, "type": kind,
            "secondary": (r.get("release_group_secondary_type") or "").lower() or None,
            "cover_url": _caa_cover(r), "mbid": group,
            "tags": (r.get("release_tags") or [])[:5],
            "sources": ["listenbrainz"],
        })
    return out


async def listenbrainz_upcoming(client: httpx.AsyncClient, today: date, horizon: int) -> list[dict]:
    """Every dated release after today, out to `horizon` days, in 90-day windows."""
    raw: list[dict] = []
    start = today
    while (start - today).days < horizon:
        span = min(LB_WINDOW, horizon - (start - today).days)
        body = await _get_json(client, "ListenBrainz", LISTENBRAINZ_FRESH, params={
            "release_date": start.isoformat(), "days": span, "past": "false", "future": "true",
            "sort": "release_date"})
        if body is None:
            raise NoUpcoming(f"ListenBrainz unreachable for the window from {start}")
        raw.extend(body.get("payload", {}).get("releases", []))
        start += timedelta(days=span)
    return [r for r in parse_listenbrainz(raw) if today.isoformat() < r["release_date"]]


# ── Wikipedia ─────────────────────────────────────────────────────────────────

MONTHS = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August",
     "September", "October", "November", "December"], 1)}
_DATE_HEAD = re.compile(r"(" + "|".join(MONTHS) + r")\s*<br\s*/?>\s*(\d{1,2})\b")
_REF = re.compile(r"<ref[^>/]*/>|<ref[^>]*>.*?</ref>", re.S)
_TEMPLATE = re.compile(r"\{\{[^{}]*\}\}")
_LINK = re.compile(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]")
_TAG = re.compile(r"<[^>]+>")


def wiki_text(cell: str) -> str:
    """A table cell as plain text: references, templates and markup gone, links
    reduced to what they show."""
    s = _REF.sub("", cell)
    while _TEMPLATE.search(s):
        s = _TEMPLATE.sub("", s)
    s = _LINK.sub(r"\1", s)
    s = _TAG.sub(" ", s).replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", _html.unescape(s)).strip()


def parse_wikitext(text: str, year: int) -> list[dict]:
    """The dated rows of a "List of {year} albums" page.

    Each day's group opens with a header cell (`! … | October<br>16`, with a
    rowspan over the day's records), then each record is a `|-` row of artist,
    album, genre, label and source. A day without a number ("TBA") is skipped:
    a calendar needs the date."""
    out: list[dict] = []
    day: str | None = None
    cells: list[str] = []

    def flush():
        if day and len(cells) >= 2:
            artist, title = wiki_text(cells[0]), wiki_text(cells[1])
            if artist and title:
                out.append({
                    "release_date": day, "artist": artist, "title": title,
                    "genre": wiki_text(cells[2]) if len(cells) > 2 else "",
                    "label": wiki_text(cells[3]) if len(cells) > 3 else "",
                })
        cells.clear()

    for line in text.splitlines():
        s = line.strip()
        if s.startswith("|-") or s.startswith("|}"):
            flush()
            if s.startswith("|}"):
                day = None
        elif s.startswith("!") and 'scope="row"' in s:
            # Every row header starts a new day, and one without a number
            # ("December<br>TBA") clears it, so its records aren't filed under
            # the day before.
            flush()
            m = _DATE_HEAD.search(s)
            try:
                day = date(year, MONTHS[m.group(1)], int(m.group(2))).isoformat() if m else None
            except ValueError:
                day = None
        elif s.startswith("|") and not s.startswith("|+") and day:
            cells.extend(c.strip() for c in s[1:].split("||"))
    flush()
    return out


def wikipedia_titles(today: date) -> list[tuple[str, int]]:
    """The pages that can hold a date between today and the horizon: this year's
    (split into halves on Wikipedia) and next year's, which starts whole and is
    split once it grows."""
    y = today.year
    titles = [(f"List of {y} albums (July–December)", y)]
    if today.month <= 6:
        titles.insert(0, (f"List of {y} albums (January–June)", y))
    titles += [(f"List of {y + 1} albums", y + 1), (f"List of {y + 1} albums (January–June)", y + 1)]
    return titles


async def wikipedia_upcoming(client: httpx.AsyncClient, today: date, horizon: int) -> list[dict]:
    end = (today + timedelta(days=horizon)).isoformat()
    out: list[dict] = []
    for title, year in wikipedia_titles(today):
        body = await _get_json(client, f"Wikipedia {title}", WIKIPEDIA_API, params={
            "action": "parse", "page": title, "prop": "wikitext", "format": "json",
            "formatversion": 2, "redirects": 1})
        text = ((body or {}).get("parse") or {}).get("wikitext")
        if text:  # a page that doesn't exist yet answers with an error, not text
            out.extend(r for r in parse_wikitext(text, year) if today.isoformat() < r["release_date"] <= end)
    # One record can appear under two page names (a redirect, a split page).
    seen, unique = set(), []
    for r in out:
        k = (r["release_date"], subject_key_album(r["artist"], r["title"]))
        if k not in seen:
            seen.add(k)
            unique.append(r)
    return unique


# ── merging ───────────────────────────────────────────────────────────────────

def merge(lb: list[dict], wiki: list[dict]) -> list[dict]:
    """ListenBrainz's list with Wikipedia's notable records folded in: a match by
    the record key (or, for a credit spelled differently, `same_album`) marks the
    ListenBrainz row notable and borrows Wikipedia's genre and label; anything
    else Wikipedia has joins the list as an album. ListenBrainz's date wins when
    both have one: it is MusicBrainz's exact release date."""
    rows = [dict(r, notable=False, notable_by=None, genre=None, label=None) for r in lb]
    by_key = {subject_key_album(r["artist"], r["title"]): r for r in rows}
    by_title: dict[str, list[dict]] = {}
    for r in rows:
        by_title.setdefault(_clean_album(r["title"]), []).append(r)
    for w in wiki:
        hit = by_key.get(subject_key_album(w["artist"], w["title"]))
        if hit is None:
            hit = next((r for r in by_title.get(_clean_album(w["title"]), [])
                        if artist_matches(w["artist"], r["artist"]) or artist_matches(r["artist"], w["artist"])), None)
        if hit is not None:
            hit.update(notable=True, notable_by="wikipedia", genre=w["genre"] or None, label=w["label"] or None)
            if "wikipedia" not in hit["sources"]:
                hit["sources"].append("wikipedia")
            continue
        row = {"release_date": w["release_date"], "artist": w["artist"], "title": w["title"],
               "type": "album", "secondary": None, "cover_url": None, "mbid": None, "tags": [],
               "sources": ["wikipedia"], "notable": True, "notable_by": "wikipedia",
               "genre": w["genre"] or None, "label": w["label"] or None}
        rows.append(row)
        by_key[subject_key_album(w["artist"], w["title"])] = row
        by_title.setdefault(_clean_album(w["title"]), []).append(row)
    for r in rows:
        r.update(key=subject_key_album(r["artist"], r["title"]),
                 deezer_id=None, itunes_id=None, track_count=None, artist_listeners=None)
    return rows


# ── enrichment ────────────────────────────────────────────────────────────────

async def deezer_match(client: httpx.AsyncClient, pacer: _Pacer, r: dict, tally: Counter) -> None:
    """An importable Deezer id, track count and cover for one record. Scans a
    page of hits, and every hit must be the same record (`same_album`).

    Paced, and retried when refused: the first build sent all 250 at once and
    Deezer refused 150 of them, which left 30 importable and sent the rest to
    iTunes's 20-a-minute queue — a 16-minute run."""
    body: dict = {}
    for attempt in range(3):
        await pacer.wait()
        try:
            resp = await client.get(f"{DEEZER_BASE}/search/album",
                                    params={"q": f"{r['artist']} {r['title']}", "limit": 10})
            body = resp.json() if resp.is_success else {}
        except (httpx.HTTPError, ValueError):
            body = {"error": "network"}
        if not body.get("error"):  # rate limiting arrives as HTTP 200 with an error body
            break
        await asyncio.sleep(2 * (attempt + 1))
    else:
        tally["deezer refused"] += 1
        return
    for a in body.get("data", []):
        if a.get("id") and same_album(r["title"], r["artist"], a.get("title") or "", (a.get("artist") or {}).get("name") or ""):
            md5 = a.get("md5_image")
            r["deezer_id"] = a["id"]
            r["track_count"] = a.get("nb_tracks") or r["track_count"]
            # A pre-release album's cover fields are null while md5_image already
            # builds a working URL.
            r["cover_url"] = r["cover_url"] or _dz_cover(a) or (
                f"https://cdn-images.dzcdn.net/images/cover/{md5}/500x500-000000-80-0-0.jpg" if md5 else None)
            r["sources"].append("deezer")
            tally["deezer found"] += 1
            return
    tally["deezer none"] += 1


async def itunes_match(client: httpx.AsyncClient, pacer: _Pacer, r: dict, tally: Counter) -> None:
    """A pre-order on iTunes: its id, track count, artwork and date."""
    await pacer.wait()
    try:
        resp = await client.get(ITUNES_SEARCH, headers={"User-Agent": UA}, params={
            "term": f"{r['artist']} {r['title']}", "entity": "album", "country": "us", "limit": 10})
        body = resp.json() if resp.is_success else {}
    except (httpx.HTTPError, ValueError):
        tally["itunes error"] += 1
        return
    for a in body.get("results", []):
        if same_album(r["title"], r["artist"], a.get("collectionName") or "", a.get("artistName") or ""):
            r["itunes_id"] = a.get("collectionId")
            r["track_count"] = r["track_count"] or a.get("trackCount")
            art = a.get("artworkUrl100") or ""
            r["cover_url"] = r["cover_url"] or (art.replace("100x100", "600x600") or None)
            r["sources"].append("itunes")
            tally["itunes found"] += 1
            return
    tally["itunes none"] += 1


async def lastfm_artist_listeners(client: httpx.AsyncClient, pacer: _Pacer, key: str,
                                  artist: str, tally: Counter) -> int | None:
    for _ in range(3):
        await pacer.wait()
        try:
            resp = await client.get(LASTFM_API, headers={"User-Agent": UA}, params={
                "method": "artist.getinfo", "artist": artist, "api_key": key,
                "format": "json", "autocorrect": 1})
            body = resp.json()
        except (httpx.HTTPError, ValueError):
            continue
        if body.get("error") == 6:       # artist not found
            tally["lastfm none"] += 1
            return None
        if body.get("error") in (11, 16, 29):  # down, temporary, rate limited
            await asyncio.sleep(2)
            continue
        n = ((body.get("artist") or {}).get("stats") or {}).get("listeners")
        if n is not None:
            tally["lastfm found"] += 1
            return int(n)
        tally["lastfm none"] += 1
        return None
    tally["lastfm gave up"] += 1
    return None


def mark_notable_by_listeners(rows: list[dict]) -> int:
    """The second rule: an album or EP, not a live album / compilation /
    soundtrack / remix / demo, by an artist with at least NOTABLE_LISTENERS.
    Returns how many it added."""
    added = 0
    for r in rows:
        if (not r["notable"] and r["type"] in ("album", "ep") and not r.get("secondary")
                and (r["artist_listeners"] or 0) >= NOTABLE_LISTENERS):
            r.update(notable=True, notable_by="listeners")
            added += 1
    return added


def order(rows: list[dict]) -> list[dict]:
    """By date; within a day, notable first, then by the artist's listeners."""
    return sorted(rows, key=lambda r: (r["release_date"], not r["notable"],
                                       -(r["artist_listeners"] or 0), r["artist"].lower()))


async def build(lastfm_key: str | None, today: date | None = None,
                horizon: int = HORIZON_DAYS) -> list[dict]:
    """The full list, ordered. Slow — run it from the worker, not a request.
    Raises NoUpcoming rather than return something too thin to store."""
    today = today or date.today()
    tally: Counter = Counter()
    started = time.monotonic()
    async with httpx.AsyncClient(timeout=25, follow_redirects=True) as client:
        lb = await listenbrainz_upcoming(client, today, horizon)
        wiki = await wikipedia_upcoming(client, today, horizon)
        tally.update(listenbrainz=len(lb), wikipedia=len(wiki))
        if len(lb) < MIN_LISTENBRAINZ:
            raise NoUpcoming(f"only {len(lb)} upcoming releases from ListenBrainz")
        if len(wiki) < MIN_WIKIPEDIA:
            raise NoUpcoming(f"only {len(wiki)} upcoming releases parsed from Wikipedia")
        rows = merge(lb, wiki)

        # Listeners first: they make records notable, and notable records are
        # the ones the lookups below fill in.
        if lastfm_key:
            pacer, lsem = _Pacer(LASTFM_PER_SECOND), asyncio.Semaphore(8)
            artists = sorted({r["artist"] for r in rows})
            listeners: dict[str, int | None] = {}

            async def one(a):
                async with lsem:
                    listeners[a] = await lastfm_artist_listeners(client, pacer, lastfm_key, a, tally)

            await asyncio.gather(*[one(a) for a in artists])
            for r in rows:
                r["artist_listeners"] = listeners.get(r["artist"])
        else:
            tally["lastfm skipped (no key)"] += 1
        tally["notable by listeners"] = mark_notable_by_listeners(rows)

        notable = [r for r in rows if r["notable"]]
        deezer_pacer = _Pacer(DEEZER_PER_SECOND)
        await asyncio.gather(*[deezer_match(client, deezer_pacer, r, tally) for r in notable])
        itunes_pacer = _Pacer(ITUNES_PER_SECOND)
        for r in [r for r in notable if not r["deezer_id"] or not r["cover_url"]]:
            await itunes_match(client, itunes_pacer, r, tally)

    LAST_TALLY.clear()
    LAST_TALLY.update(tally, seconds=round(time.monotonic() - started))
    return order(rows)


# ── the stored copy ───────────────────────────────────────────────────────────

def read_stored(session: Session) -> tuple[list[dict], datetime] | None:
    """(releases, when built) from `cachedfeed`, or None. Never raises."""
    try:
        row = session.get(CachedFeed, FEED_KEY)
        if row is None:
            return None
        return json.loads(row.payload_json), row.fetched_at
    except Exception as e:
        session.rollback()
        print(f"[upcoming] stored copy unreadable: {e}")
        return None


def write_stored(session: Session, releases: list[dict]) -> None:
    """Replace the stored copy. Raises: the worker must fail loudly."""
    row = session.get(CachedFeed, FEED_KEY) or CachedFeed(key=FEED_KEY, payload_json="")
    row.payload_json = json.dumps(releases)
    row.fetched_at = datetime.utcnow()
    session.add(row)
    session.commit()


# ── serving ───────────────────────────────────────────────────────────────────

def select_upcoming(releases: list[dict], today: date, days: int, types: set[str],
                    notable_only: bool, include_secondary: bool, library_artists: set[str]) -> list[dict]:
    """What the endpoint returns: still upcoming on `today` (the stored list is
    up to a day old), within `days`, of the asked-for types, each flagged when
    it's by an artist the caller has in their library."""
    end = (today + timedelta(days=days)).isoformat()
    out = []
    for r in releases:
        if not (today.isoformat() < r["release_date"] <= end) or r["type"] not in types:
            continue
        if notable_only and not r["notable"]:
            continue
        if r.get("secondary") and not include_secondary:
            continue
        out.append({**r, "artist_in_library": artist_key(r["artist"]) in library_artists})
    return out
