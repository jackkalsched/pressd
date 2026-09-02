"""
New-release discovery.

`/discover/new-releases` returns a cached list of recent album releases sourced
from ListenBrainz's fresh-releases feed, each resolved to a Deezer album so the
existing import flow (`/discover/deezer/{id}`) can add it to a library or open
it in the rating screen. Falls back to Deezer's editorial/chart feed when
ListenBrainz is unavailable.
"""
import asyncio
import time
from datetime import date, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlmodel import Session, select

from ..database import get_session
from ..deps import current_user
from ..global_rating import compute_global_ratings, is_single
from ..models import Album, PressUser
from ..trackkeys import same_album
from ..aoty_releases import AOTY_THIS_WEEK, AOTY_UA, parse_releases

router = APIRouter(prefix="/discover", tags=["discover"])

DEEZER_BASE = "https://api.deezer.com"
LISTENBRAINZ_FRESH = "https://api.listenbrainz.org/1/explore/fresh-releases/"
LB_UA = "Pressd/1.0 (https://www.pressdmusic.com)"
CACHE_TTL = 6 * 3600  # releases move slowly; refresh a few times a day
_cache: dict = {"releases": None, "expires": 0.0}


def _cover(a: dict) -> str | None:
    return a.get("cover_xl") or a.get("cover_big") or a.get("cover_medium") or None


def _year(release_date: str | None) -> int | None:
    return int(release_date[:4]) if release_date and release_date[:4].isdigit() else None


def _caa_cover(r: dict) -> str | None:
    cid, mbid = r.get("caa_id"), r.get("caa_release_mbid")
    return f"https://coverartarchive.org/release/{mbid}/{cid}-500.jpg" if cid and mbid else None


async def _listenbrainz_fresh(client: httpx.AsyncClient, days: int = 7) -> list[dict]:
    """Recent album releases from ListenBrainz, most recent first."""
    try:
        resp = await client.get(
            LISTENBRAINZ_FRESH,
            params={"days": days, "sort": "release_date", "past": "true", "future": "false"},
            headers={"User-Agent": LB_UA},
        )
    except httpx.HTTPError:
        return []
    if not resp.is_success:  # 400 on a bad date / days > 90, etc.
        return []
    rels = resp.json().get("payload", {}).get("releases", [])
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for r in rels:
        title, artist = r.get("release_name"), r.get("artist_credit_name")
        if not (title and artist) or r.get("release_group_primary_type") != "Album":
            continue
        key = (title.lower(), artist.lower())
        if key in seen:
            continue
        seen.add(key)
        out.append({"title": title, "artist": artist, "release_date": r.get("release_date"), "caa": _caa_cover(r)})
    out.sort(key=lambda x: x["release_date"] or "", reverse=True)
    return out


async def _deezer_resolve(client: httpx.AsyncClient, sem: asyncio.Semaphore, title: str, artist: str) -> dict | None:
    """Match a release to a Deezer album for the importable id + cover.

    Scans a page of hits rather than only the first: Deezer frequently ranks a
    single or a lead track above the album itself, so the record we want is
    often the second or third result.
    """
    try:
        async with sem:
            resp = await client.get(
                f"{DEEZER_BASE}/search/album", params={"q": f"{artist} {title}", "limit": 10}
            )
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
        # Guard against a wrong match: the hit has to be the same record, not
        # just something Deezer ranked highly for the query. Title and artist
        # must both line up — a different album by the right artist is as wrong
        # as a same-titled album by someone else.
        dz_artist_obj = a.get("artist") or {}
        if not same_album(title, artist, a.get("title") or "", dz_artist_obj.get("name") or ""):
            continue
        return {
            "deezer_id": a["id"],
            "artist_id": dz_artist_obj.get("id"),
            "cover_url": _cover(a),
            "nb_tracks": a.get("nb_tracks"),
        }
    return None


async def _aoty_this_week(client: httpx.AsyncClient) -> list[dict]:
    """This week's releases from albumoftheyear.org, most-rated first. One page
    fetch; returns [] on any failure so the caller falls back."""
    try:
        resp = await client.get(AOTY_THIS_WEEK, headers={"User-Agent": AOTY_UA})
    except httpx.HTTPError:
        return []
    if not resp.is_success:
        return []
    try:
        return parse_releases(resp.text)
    except Exception as e:  # markup drifted — degrade instead of 500ing
        print(f"[new-releases] AOTY parse failed: {e}")
        return []


async def _artist_fans(client: httpx.AsyncClient, sem: asyncio.Semaphore, artist_id: int | None) -> int:
    """Total Deezer fan count of the releasing artist — the popularity signal we
    rank by, so a fresh album by a well-known artist floats to the top."""
    if not artist_id:
        return 0
    try:
        async with sem:
            resp = await client.get(f"{DEEZER_BASE}/artist/{artist_id}")
    except httpx.HTTPError:
        return 0
    if not resp.is_success:
        return 0
    body = resp.json()
    return 0 if body.get("error") else (body.get("nb_fan") or 0)


async def _deezer_editorial(client: httpx.AsyncClient) -> list[dict]:
    """Fallback: Deezer's editorial releases, else the global album chart."""
    resp = await client.get(f"{DEEZER_BASE}/editorial/0/releases", params={"limit": 40})
    items = resp.json().get("data", []) if resp.is_success else []
    if not items:
        resp = await client.get(f"{DEEZER_BASE}/chart/0/albums", params={"limit": 40})
        items = resp.json().get("data", []) if resp.is_success else []
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for a in items:
        aid, title = a.get("id"), a.get("title")
        artist = (a.get("artist") or {}).get("name")
        if not (aid and title and artist):
            continue
        key = (title.lower(), artist.lower())
        if key in seen:
            continue
        seen.add(key)
        rd = a.get("release_date") or ""
        out.append({
            "deezer_id": aid, "album_name": title, "artist": artist, "cover_url": _cover(a),
            "year": _year(rd), "release_date": rd or None, "nb_tracks": a.get("nb_tracks"),
        })
    return out


@router.get("/new-releases")
async def new_releases(
    limit: int = Query(12, ge=1, le=30),
    user: PressUser = Depends(current_user),
):
    now = time.monotonic()
    if _cache["releases"] and _cache["expires"] > now:  # only serve a non-empty cache
        return _cache["releases"][:limit]

    releases: list[dict] = []
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        sem = asyncio.Semaphore(10)  # keep Deezer calls under its rate limit

        # Primary: AOTY's this-week listing, already ordered by how many people
        # have rated each release — a per-record popularity signal neither
        # ListenBrainz nor Deezer provides. Deezer is still consulted, but only
        # to resolve an importable album id for the top slice.
        aoty = await _aoty_this_week(client)
        if aoty:
            # Generous spares: anything that won't resolve is dropped below, and
            # AOTY lists plenty of small releases that aren't on Deezer at all.
            top = aoty[:limit + 12]
            resolved = await asyncio.gather(
                *[_deezer_resolve(client, sem, r["album_name"], r["artist"]) for r in top]
            )
            for r, dz in zip(top, resolved):
                # A release we can't resolve has no tracklist and nothing to
                # rate, so it's left out rather than shown as a dead end.
                if not dz:
                    continue
                releases.append({
                    "deezer_id": dz["deezer_id"],
                    "album_name": r["album_name"],
                    "artist": r["artist"],
                    "cover_url": r["cover_url"] or dz["cover_url"],
                    "year": None,
                    "release_date": None,
                    "nb_tracks": dz["nb_tracks"],
                    "rater_count": r["user_count"],
                    "user_score": r["user_score"],
                    "critic_score": r["critic_score"],
                })

        if not releases:
            # Fallback: ListenBrainz's fresh feed, ranked by the releasing
            # artist's total Deezer fan count — the best available proxy when
            # there's no per-release signal. Sample evenly across the week so
            # earlier releases are represented, and keep the pool under
            # Deezer's ~50-per-5s quota.
            POOL = 24
            allcands = await _listenbrainz_fresh(client, days=7)
            if len(allcands) > POOL:
                step = len(allcands) / POOL
                candidates = [allcands[int(i * step)] for i in range(POOL)]
            else:
                candidates = allcands
            resolved = await asyncio.gather(*[_deezer_resolve(client, sem, c["title"], c["artist"]) for c in candidates])
            matched = [(c, dz) for c, dz in zip(candidates, resolved) if dz]
            fans = await asyncio.gather(*[_artist_fans(client, sem, dz.get("artist_id")) for _, dz in matched])
            for (c, dz), f in zip(matched, fans):
                releases.append({
                    "deezer_id": dz["deezer_id"],
                    "album_name": c["title"],
                    "artist": c["artist"],
                    "cover_url": dz["cover_url"] or c["caa"],
                    "year": _year(c["release_date"]),
                    "release_date": c["release_date"],
                    "nb_tracks": dz["nb_tracks"],
                    "_fans": f,
                })
            releases.sort(key=lambda r: r["_fans"], reverse=True)
            for r in releases:
                r.pop("_fans", None)

        if not releases:  # both feeds down → Deezer's own editorial list
            releases = await _deezer_editorial(client)
            if not releases:
                raise HTTPException(status_code=502, detail="Could not load new releases")

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

    The displayed `avg_score` is always the album's all-time average across the
    whole userbase; for the weekly view only the `rater_count` (and ranking) is
    scoped to the last 7 days.

    Each row links to the current user's own copy when they have one, otherwise
    to the most recently rated copy.
    """
    base = (
        select(Album)
        .where(Album.status == "rated")
        .where(Album.score.is_not(None))
    )
    q = base
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

    # Weekly view: the score shown should be the album's all-time userbase
    # average, not just this week's ratings. Re-aggregate scores over every
    # rated copy (all time) for the albums that trended this week; rater_count
    # stays scoped to the week.
    if period == "week" and groups:
        alltime: dict[tuple[str, str], list[float]] = {}
        for a in session.exec(base).all():
            key = (a.album_name.strip().lower(), a.artist.strip().lower())
            if key in groups:
                alltime.setdefault(key, []).append(a.score)
        for key, g in groups.items():
            if alltime.get(key):
                g["scores"] = alltime[key]

    # Singles stay off trending for the same reason they stay off the charts.
    global_ratings = compute_global_ratings(session)
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
        for key, g in groups.items()
        if not is_single(global_ratings, key)
    ]

    if period == "top":
        rows.sort(key=lambda r: (r["avg_score"] or 0, r["rater_count"]), reverse=True)
    else:
        rows.sort(key=lambda r: (r["rater_count"], r["last_rated"] or ""), reverse=True)
    return rows[:limit]


@router.get("/charts")
def charts(
    period: str = Query("week", pattern="^(week|all)$"),
    genre: str | None = Query(default=None),
    decade: int | None = Query(default=None),   # e.g. 2020 for the 2020s
    year: int | None = Query(default=None),
    artist: str | None = Query(default=None),
    limit: int = Query(50, ge=1, le=50),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Userbase-wide album chart: rated albums grouped across every user's copy,
    ranked by aggregate average score. `period` scopes which ratings count —
    "week" only counts copies rated in the last 7 days, "all" counts everything.
    Optional filters by genre, decade, and/or year. Each entry carries its
    day-over-day rank movement (the ranking as it stood at the end of yesterday,
    excluding copies first rated today), and the response includes the filter
    facets available across the whole catalog.
    """
    # Columns only (no relationship access) — cheap over the whole rated set.
    rows = session.exec(
        select(
            Album.id, Album.album_name, Album.artist, Album.year, Album.genre,
            Album.score, Album.date_rated, Album.user_id, Album.album_art_url,
        ).where(Album.status == "rated", Album.score.is_not(None))
    ).all()

    # Facets from the full catalog, independent of the active filter so the
    # chip row stays stable as you switch filters.
    genre_counts: dict[str, int] = {}
    decades: set[int] = set()
    years: set[int] = set()
    for r in rows:
        if r.genre:
            genre_counts[r.genre] = genre_counts.get(r.genre, 0) + 1
        if r.year:
            decades.add((r.year // 10) * 10)
            years.add(r.year)
    facets = {
        "genres": [g for g, _ in sorted(genre_counts.items(), key=lambda kv: kv[1], reverse=True)[:8]],
        "decades": sorted(decades, reverse=True),
        "years": sorted(years, reverse=True)[:15],
    }

    # Active filter (one dimension at a time).
    def keep(r) -> bool:
        if genre and (r.genre or "").lower() != genre.lower():
            return False
        if decade and (r.year is None or (r.year // 10) * 10 != decade):
            return False
        if year and r.year != year:
            return False
        # Substring, not equality — this one is typed a character at a time,
        # so the board should narrow as you go rather than stay empty until
        # the name is spelled out in full.
        if artist and artist.strip().lower() not in (r.artist or "").lower():
            return False
        return True

    today = date.today()
    pool = [r for r in rows if keep(r)]
    if period == "week":
        week_ago = today - timedelta(days=7)
        pool = [r for r in pool if r.date_rated is not None and r.date_rated >= week_ago]

    global_ratings = compute_global_ratings(session)

    def build(subset):
        """Group by (album, artist); return keys ranked by the global rating."""
        groups: dict[tuple[str, str], dict] = {}
        for r in subset:
            key = (r.album_name.strip().lower(), r.artist.strip().lower())
            g = groups.get(key)
            if g is None:
                g = {"name": r.album_name, "artist": r.artist, "year": r.year,
                     "art": r.album_art_url, "scores": [], "raters": set(),
                     "rep_id": r.id, "rep_date": r.date_rated, "own_id": None}
                groups[key] = g
            g["scores"].append(r.score)
            if r.user_id is not None:
                g["raters"].add(r.user_id)
            if r.album_art_url and not g["art"]:
                g["art"] = r.album_art_url
            if r.date_rated and (g["rep_date"] is None or r.date_rated > g["rep_date"]):
                g["rep_date"], g["rep_id"] = r.date_rated, r.id
            if r.user_id == user.id:
                g["own_id"] = r.id
        # Ranked by the global Pressd rating (pooled raw inputs scored once on
        # the userbase's scale), falling back to the average of per-user scores
        # only where the pooled pass had nothing to work with.
        def rank_score(kv):
            gr = global_ratings.get(kv[0])
            return gr["score"] if gr else sum(kv[1]["scores"]) / len(kv[1]["scores"])

        return sorted(groups.items(), key=lambda kv: (rank_score(kv), len(kv[1]["raters"])),
                      reverse=True)

    # Singles don't chart — see the note in public.py's equivalent.
    today_ranked = [kv for kv in build(pool) if not is_single(global_ratings, kv[0])]
    # Yesterday's board: copies first rated today don't count yet.
    yest_ranked = [kv for kv in build([r for r in pool if r.date_rated is None or r.date_rated < today])
                   if not is_single(global_ratings, kv[0])]
    yest_rank = {key: i + 1 for i, (key, _) in enumerate(yest_ranked)}

    items = []
    for i, (key, g) in enumerate(today_ranked[:limit]):
        rank = i + 1
        yr = yest_rank.get(key)
        items.append({
            "rank": rank,
            "album_id": g["own_id"] or g["rep_id"],
            "album_name": g["name"],
            "artist": g["artist"],
            "year": g["year"],
            "album_art_url": g["art"],
            # Field name kept for the shipped clients, which read `avg_score`;
            # the value is now the pooled global rating rather than a mean.
            "avg_score": round((global_ratings.get(key) or {}).get(
                "score", sum(g["scores"]) / len(g["scores"])), 2),
            "rater_count": len(g["raters"]),
            "movement": (yr - rank) if yr is not None else None,  # + up, − down, None = new
        })

    return {"items": items, "facets": facets}


@router.get("/picks")
def picks(
    limit: int = Query(10, ge=1, le=30),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Records this user is predicted to rate highly, drawn from the whole
    catalog rather than their own queue.

    The nightly worker fits a model per user and scores every album anyone has
    added into `albumprediction` — so a prediction exists for records the user
    has never heard of. Nothing served that table until now, which meant "Rate
    this next" could only ever offer something already sitting in To Listen: a
    long list for the one user who queues heavily, and nothing at all for
    everyone else.

    Anything already in their library is filtered out — a pick they own is a
    queue item, not a discovery.
    """
    rows = session.execute(text("""
        SELECT p.album_name, p.artist, p.year, p.genre, p.album_art_url,
               p.predicted_score
        FROM albumprediction p
        WHERE p.user_id = :uid
          AND p.predicted_score IS NOT NULL
          AND COALESCE(p.already_rated, FALSE) = FALSE
          AND NOT EXISTS (
            SELECT 1 FROM album a
            WHERE a.user_id = p.user_id
              AND lower(trim(a.album_name)) = lower(trim(p.album_name))
              AND lower(trim(a.artist)) = lower(trim(p.artist))
          )
        ORDER BY p.predicted_score DESC
        LIMIT :lim
    """), {"uid": user.id, "lim": limit}).fetchall()

    return [
        {
            "album_name": r.album_name,
            "artist": r.artist,
            "year": r.year,
            "genre": r.genre,
            "album_art_url": r.album_art_url,
            "predicted_score": round(r.predicted_score, 2),
        }
        for r in rows
    ]


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


# ── Most divisive (PLAN_discussions.md §8) ───────────────────────────────────
# You already hold every user's score for a record, so disagreement is a
# `stddev` away — and it is the one discovery signal here that no competitor
# can compute, because nobody else has the per-user distributions.

# §8.1 asks for 5. Measured against the live database on 2026-09-02 the whole
# userbase produced exactly one record with 4 raters and seven with 3, so a
# floor of 5 would render an empty rail forever. Three is what this data can
# support; raise it toward 5 as the userbase grows, because at three a single
# contrarian is the entire "division".
MIN_DIVISIVE_RATERS = 3

# Two tracks or fewer is a single. Kept off this rail for the same reason
# charts keep it off theirs: a one-track release rated 10 and 2 by two people
# is noise wearing the shape of a controversy.
DIVISIVE_MIN_TRACKS = 3


@router.get("/divisive")
def divisive(
    window: str = Query("all", pattern="^(week|all)$"),
    limit: int = Query(10, ge=1, le=30),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Records the userbase most disagrees about.

    The hot/cold split is measured against **each rater's own library mean**,
    not an absolute cutoff (§8.2). Everyone's scores sit on their own
    distribution — that is the premise of `backend.scoring` — so "60% flame"
    means 60% liked it more than they like their own library, which is a real
    claim. A flat 7.0 line would mostly measure who rates generously.

    `window=week` narrows to records someone rated in the last seven days.
    Defaults to `all` because at this userbase's size the weekly set is
    routinely empty, and an empty rail teaches people to stop looking.
    """
    recent = "AND EXISTS (SELECT 1 FROM album w WHERE w.subject_key = a.subject_key" \
             "   AND w.status = 'rated' AND w.date_rated > CURRENT_DATE - 7)" if window == "week" else ""

    rows = session.execute(text(f"""
        WITH means AS (
            SELECT user_id, AVG(score) AS mean FROM album
            WHERE status = 'rated' AND score IS NOT NULL GROUP BY user_id
        ),
        sizes AS (
            SELECT a.subject_key, MAX(c.n) AS tracks
            FROM album a
            JOIN (SELECT album_id, COUNT(*) n FROM song GROUP BY album_id) c ON c.album_id = a.id
            GROUP BY a.subject_key
        ),
        rated AS (
            SELECT a.subject_key, a.user_id, a.score, m.mean
            FROM album a
            JOIN means m ON m.user_id = a.user_id
            WHERE a.status = 'rated' AND a.score IS NOT NULL AND a.subject_key IS NOT NULL
              {recent}
        )
        SELECT r.subject_key,
               COUNT(*)                                        AS raters,
               STDDEV_POP(r.score)                              AS spread,
               COUNT(*) FILTER (WHERE r.score >  r.mean)        AS hot,
               COUNT(*) FILTER (WHERE r.score <= r.mean)        AS cold,
               AVG(r.score)                                     AS mean_score
        FROM rated r
        JOIN sizes z ON z.subject_key = r.subject_key
        WHERE z.tracks >= :mintracks
        GROUP BY r.subject_key
        HAVING COUNT(*) >= :minraters
        ORDER BY STDDEV_POP(r.score) DESC NULLS LAST, COUNT(*) DESC
        LIMIT :lim
    """), {"minraters": MIN_DIVISIVE_RATERS, "mintracks": DIVISIVE_MIN_TRACKS,
           "lim": limit}).fetchall()
    if not rows:
        return []

    keys = tuple(r[0] for r in rows)
    # One lookup for every record's display fields, preferring a copy that has
    # cover art — the row that sorts first is often a stub imported without one.
    meta = {
        m[0]: (m[1], m[2], m[3])
        for m in session.execute(text("""
            SELECT DISTINCT ON (subject_key) subject_key, album_name, artist, album_art_url
            FROM album WHERE subject_key IN :keys
            ORDER BY subject_key, (album_art_url IS NULL), id
        """), {"keys": keys}).fetchall()
    }

    out = []
    for key, raters, spread, hot, cold, mean_score in rows:
        name, artist, art = meta.get(key, (key.split("||")[-1], None, None))
        total = (hot or 0) + (cold or 0)
        out.append({
            "subject_key": key,
            "album_name": name,
            "artist": artist,
            "album_art_url": art,
            "raters": raters,
            "spread": round(float(spread or 0), 2),
            "mean_score": round(float(mean_score or 0), 2),
            "hot": hot or 0,
            "cold": cold or 0,
            # Percentages so the client draws a bar without re-deriving them,
            # and so the two always sum to 100 rather than 99 or 101.
            "hot_pct": round(100 * (hot or 0) / total) if total else 0,
            "cold_pct": 100 - round(100 * (hot or 0) / total) if total else 0,
        })
    return out
