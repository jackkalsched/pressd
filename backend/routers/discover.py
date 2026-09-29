"""
Discovery surfaces: new releases, the userbase charts, picks, and heated threads.

`/discover/new-releases` serves the list `backend/new_releases.py` builds: this
week's releases ranked by Last.fm listeners, since albumoftheyear.org answers
automated requests with a Cloudflare challenge (that module has the history and
the measurements). Building it takes minutes, so worker/refresh_new_releases.py
does it every 6 hours and stores it in `cachedfeed`; this endpoint only reads.
"""
import json
import time
from datetime import date, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlmodel import Session, select

from ..database import get_session
from ..deps import current_user
from ..global_rating import compute_global_ratings, is_single
from ..scoring import BANG_THRESHOLD, SKIP_THRESHOLD
from ..models import Album, PressUser
from ..new_releases import (
    DEEZER_BASE, NoReleases, cover as _cover, quick_build, read_stored, write_stored,
    year as _year,
)

router = APIRouter(prefix="/discover", tags=["discover"])

# How long this process trusts its in-memory copy before re-reading the stored
# row. Short, so a list the worker has just written reaches users within the
# half hour; a re-read is one primary-key lookup.
MEMORY_TTL = 30 * 60
# How old a stored list may be and still be served. The worker refreshes every
# 6 hours, so this is how long it can be down before the endpoint builds its
# own. A week's releases don't change fast enough for a day-old list to be wrong.
STALE_OK = 3 * 24 * 3600
_cache: dict = {"releases": None, "expires": 0.0}


@router.get("/new-releases")
async def new_releases(
    limit: int = Query(12, ge=1, le=30),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    now = time.monotonic()
    if _cache["releases"] and _cache["expires"] > now:
        return _cache["releases"][:limit]

    stored = read_stored(session)
    if stored is not None and stored[1] < STALE_OK:
        _cache["releases"], _cache["expires"] = stored[0], now + MEMORY_TTL
        return stored[0][:limit]

    # Nothing recent from the worker (first deploy, or it has been failing for
    # days — GitHub shows that run red). Build a quick list rather than fail.
    try:
        releases = await quick_build()
    except NoReleases as e:
        print(f"[new-releases] quick build failed: {e}")
        if stored is not None:  # an old list beats an error
            return stored[0][:limit]
        raise HTTPException(status_code=502, detail="Could not load new releases")
    _cache["releases"], _cache["expires"] = releases, now + MEMORY_TTL
    try:
        write_stored(session, releases)
    except Exception as e:
        session.rollback()
        print(f"[new-releases] could not store the quick list: {e}")
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


# ── Heated discussions (PLAN_discussions.md §8) ──────────────────────────────
# Records people are actively writing about, ranked by review activity rather
# than by disagreement. Disagreement survives as a *tag* rather than the sort:
# spread is a real signal but a slow-moving one, and a section that never
# changes stops being looked at.

# Recent means the last three days. Used to *order* the section, not to filter
# it — measured on 2026-09-02 the whole userbase wrote 0 reviews in three days
# and 1 in seven, so filtering would have shipped a section that never renders.
# Records with recent reviews float up; the rest still show beneath them.
HEATED_WINDOW_DAYS = 3

# A whole point of standard deviation means two listeners routinely land a
# grade apart on the same record. Below that it is rounding, not a controversy.
CONTROVERSIAL_SPREAD = 1.0

# The ends of the scale, well clear of the 6.5/8.0 lines a single album crosses,
# so a tag says something about the room rather than about one generous rater.
LOVED_MEAN = 8.5
HATED_MEAN = 6.0

# "New" in the sense a listener means it, not a chart's.
NEW_RELEASE_DAYS = 14


@router.get("/heated")
def heated(
    limit: int = Query(10, ge=1, le=30),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Records with the most review activity, newest first.

    The tags are computed here rather than in the client so the thresholds live
    in one place and both platforms cannot drift apart on what "controversial"
    means. They are deliberately arbitrary — see the constants above for what
    each one is trying to say.

    `is_new` is null-safe by design: `release_date` was never stored before
    2026-09-02, so anything imported earlier simply never reads as new rather
    than guessing from `year` and calling a twelve-month-old record fresh.
    """
    rows = session.execute(text("""
        WITH reviews AS (
            SELECT t.subject_key,
                   COUNT(*) AS total,
                   COUNT(*) FILTER (
                       WHERE p.created_at > NOW() - make_interval(days => :win)
                   ) AS recent,
                   MAX(p.created_at) AS last_at
            FROM post p JOIN thread t ON t.id = p.thread_id
            WHERE t.subject_type = 'album' AND p.kind = 'review' AND p.deleted_at IS NULL
            GROUP BY t.subject_key
        ),
        scores AS (
            SELECT subject_key, AVG(score) AS mean, STDDEV_POP(score) AS spread,
                   COUNT(*) AS raters, MAX(release_date) AS release_date
            FROM album
            WHERE status = 'rated' AND score IS NOT NULL AND subject_key IS NOT NULL
            GROUP BY subject_key
        )
        SELECT r.subject_key, r.total, r.recent, r.last_at,
               s.mean, s.spread, s.raters, s.release_date
        FROM reviews r
        JOIN scores s ON s.subject_key = r.subject_key
        ORDER BY r.recent DESC, r.total DESC, r.last_at DESC
        LIMIT :lim
    """), {"win": HEATED_WINDOW_DAYS, "lim": limit}).fetchall()
    if not rows:
        return []

    keys = tuple(r[0] for r in rows)
    meta = {
        m[0]: (m[1], m[2], m[3])
        for m in session.execute(text("""
            SELECT DISTINCT ON (subject_key) subject_key, album_name, artist, album_art_url
            FROM album WHERE subject_key IN :keys
            ORDER BY subject_key, (album_art_url IS NULL), id
        """), {"keys": keys}).fetchall()
    }

    today = date.today()
    out = []
    for key, total, recent, last_at, mean, spread, raters, release_date in rows:
        name, artist, art = meta.get(key, (key.split("||")[-1], None, None))
        mean_f = float(mean) if mean is not None else None
        spread_f = float(spread) if spread is not None else 0.0
        out.append({
            "subject_key": key,
            "album_name": name,
            "artist": artist,
            "album_art_url": art,
            "review_count": total,
            "recent_reviews": recent,
            "raters": raters,
            "mean_score": round(mean_f, 2) if mean_f is not None else None,
            "spread": round(spread_f, 2),
            "controversial": spread_f >= CONTROVERSIAL_SPREAD,
            "loved": mean_f is not None and mean_f >= LOVED_MEAN,
            "hated": mean_f is not None and mean_f <= HATED_MEAN,
            "is_new": bool(release_date and (today - release_date).days <= NEW_RELEASE_DAYS),
        })
    return out
