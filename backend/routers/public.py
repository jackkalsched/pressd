"""Endpoints served to logged-out visitors on the marketing site.

Deliberately separate from `discover.py`, which mirrors these charts for
signed-in users. The two differ in ways that matter: this one takes no auth,
exposes only aggregate figures (never who rated what), and links each entry to
a representative copy rather than "your" copy of the album. Keeping it apart
also means the public surface can't accidentally inherit a personalisation
change made for the authenticated app.

Nothing here may return per-user data. Album/artist aggregates are fine —
they are the same numbers the chart itself displays.
"""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from ..database import get_session
from ..models import Album

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/charts")
def public_charts(
    period: str = Query("week", pattern="^(week|all)$"),
    genre: str | None = Query(default=None),
    decade: int | None = Query(default=None),
    year: int | None = Query(default=None),
    artist: str | None = Query(default=None),
    limit: int = Query(50, ge=1, le=50),
    session: Session = Depends(get_session),
):
    """Userbase-wide album chart, ranked by average score across every copy.

    `period="week"` counts only copies rated in the last 7 days. Movement is
    the change against the board as it stood at the end of yesterday, so a
    brand-new entry reports null rather than a fake climb.
    """
    rows = session.exec(
        select(
            Album.id, Album.album_name, Album.artist, Album.year, Album.genre,
            Album.score, Album.date_rated, Album.user_id, Album.album_art_url,
        ).where(Album.status == "rated", Album.score.is_not(None))
    ).all()

    # Facets come from the whole catalog, not the filtered pool, so the filter
    # controls don't disappear as soon as you narrow the board.
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

    def keep(r) -> bool:
        if genre and (r.genre or "").lower() != genre.lower():
            return False
        if decade and (r.year is None or (r.year // 10) * 10 != decade):
            return False
        if year and r.year != year:
            return False
        # Substring, not equality — typed a character at a time, so the board
        # narrows as you go instead of staying empty until the name is complete.
        if artist and artist.strip().lower() not in (r.artist or "").lower():
            return False
        return True

    today = date.today()
    pool = [r for r in rows if keep(r)]
    if period == "week":
        week_ago = today - timedelta(days=7)
        pool = [r for r in pool if r.date_rated is not None and r.date_rated >= week_ago]

    def build(subset):
        """Group every user's copy of the same record together, best first."""
        groups: dict[tuple[str, str], dict] = {}
        for r in subset:
            key = (r.album_name.strip().lower(), r.artist.strip().lower())
            g = groups.get(key)
            if g is None:
                g = {"name": r.album_name, "artist": r.artist, "year": r.year,
                     "art": r.album_art_url, "scores": [], "raters": set(),
                     "rep_id": r.id, "rep_date": r.date_rated}
                groups[key] = g
            g["scores"].append(r.score)
            if r.user_id is not None:
                g["raters"].add(r.user_id)
            if r.album_art_url and not g["art"]:
                g["art"] = r.album_art_url
            if r.date_rated and (g["rep_date"] is None or r.date_rated > g["rep_date"]):
                g["rep_date"], g["rep_id"] = r.date_rated, r.id
        return sorted(
            groups.items(),
            key=lambda kv: (sum(kv[1]["scores"]) / len(kv[1]["scores"]), len(kv[1]["raters"])),
            reverse=True,
        )

    today_ranked = build(pool)
    yest_ranked = build([r for r in pool if r.date_rated is None or r.date_rated < today])
    yest_rank = {key: i + 1 for i, (key, _) in enumerate(yest_ranked)}

    items = []
    for i, (key, g) in enumerate(today_ranked[:limit]):
        rank = i + 1
        yr = yest_rank.get(key)
        items.append({
            "rank": rank,
            # A representative copy, never the viewer's — there is no viewer.
            "album_id": g["rep_id"],
            "album_name": g["name"],
            "artist": g["artist"],
            "year": g["year"],
            "album_art_url": g["art"],
            "avg_score": round(sum(g["scores"]) / len(g["scores"]), 2),
            "rater_count": len(g["raters"]),
            "movement": (yr - rank) if yr is not None else None,
        })

    return {"items": items, "facets": facets}
