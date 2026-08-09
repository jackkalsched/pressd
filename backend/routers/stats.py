from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select, func
from sqlalchemy.orm import selectinload
from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import Optional
import statistics
import json
import os

from ..database import get_session
from ..deps import current_user, viewable_user_id
from ..models import Album, ArtistMeta, Song
from ..trackkeys import _clean_album as _same_record
from ..scoring import BANG_THRESHOLD, SKIP_THRESHOLD, compute_a_score, get_factor_stats

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/factor-stats")
def factor_stats(_user=Depends(current_user), session: Session = Depends(get_session)):
    stats = get_factor_stats(session)
    return {k: list(v) for k, v in stats.items()}


@router.get("/score-range")
def score_range(user_id: int = Depends(viewable_user_id), session: Session = Depends(get_session)):
    scores = [
        a.score for a in session.exec(
            select(Album).where(Album.user_id == user_id, Album.status == "rated", Album.score.is_not(None))
        ).all()
    ]
    if len(scores) < 2:
        return {"mu": 7.0, "sd": 1.0, "min": 1.0, "max": 10.0}
    return {
        "mu": statistics.mean(scores),
        "sd": statistics.stdev(scores),
        "min": min(scores),
        "max": max(scores),
    }


@router.get("/summary")
def summary(user_id: int = Depends(viewable_user_id), session: Session = Depends(get_session)):
    rated = session.exec(
        select(Album).where(Album.status == "rated").where(Album.user_id == user_id)
    ).all()
    all_songs = session.exec(
        select(Song)
        .join(Album, Song.album_id == Album.id)
        .where(Album.user_id == user_id)
        .where(Song.score.is_not(None))
    ).all()

    scores = [a.score for a in rated if a.score is not None]
    top_album = max(rated, key=lambda a: a.score or 0, default=None)
    top_song = max(all_songs, key=lambda s: s.score or 0, default=None)

    def _avg(vals):
        v = [x for x in vals if x is not None]
        return round(sum(v) / len(v), 2) if v else None

    # Most loyal artist (most rated albums)
    artist_counts: dict[str, int] = defaultdict(int)
    for a in rated:
        artist_counts[a.artist] += 1
    most_loyal = max(artist_counts.items(), key=lambda x: x[1], default=None)

    # Best genre (highest avg score, min 3 albums)
    genre_scores_map: dict[str, list[float]] = defaultdict(list)
    for a in rated:
        if a.genre and a.score is not None:
            genre_scores_map[a.genre].append(a.score)
    qualified = {g: s for g, s in genre_scores_map.items() if len(s) >= 3}
    best_genre_entry = max(qualified.items(), key=lambda x: sum(x[1]) / len(x[1]), default=None)

    # Avg release year
    years = [a.year for a in rated if a.year]
    avg_year = round(sum(years) / len(years)) if years else None

    # Longest consecutive-day rating streak
    rated_dates = sorted({a.date_rated for a in rated if a.date_rated})
    longest_streak = 1
    if len(rated_dates) > 1:
        cur = 1
        for i in range(1, len(rated_dates)):
            if (rated_dates[i] - rated_dates[i - 1]).days == 1:
                cur += 1
                longest_streak = max(longest_streak, cur)
            else:
                cur = 1

    # Albums rated this calendar year
    this_year = date.today().year
    albums_this_year = sum(1 for a in rated if a.date_rated and a.date_rated.year == this_year)

    # Perfect 10 songs
    total_10s = sum(1 for s in all_songs if s.score == 10.0)

    return {
        "total_albums_rated": len(rated),
        "total_songs_rated": len(all_songs),
        "avg_album_score": round(sum(scores) / len(scores), 4) if scores else None,
        "top_album": {"name": top_album.album_name, "artist": top_album.artist, "score": top_album.score} if top_album else None,
        "top_song": {"title": top_song.title, "artist": top_song.artist, "score": top_song.score} if top_song else None,
        "avg_song_score": _avg([s.score for s in all_songs]),
        "avg_theme": _avg([a.theme for a in rated]),
        "avg_replay": _avg([a.replay_value for a in rated]),
        "avg_production": _avg([a.production for a in rated]),
        "avg_distinctness": _avg([a.distinctness for a in rated]),
        "most_rated_artist": {"name": most_loyal[0], "count": most_loyal[1]} if most_loyal else None,
        "best_genre": {
            "genre": best_genre_entry[0],
            "avg_score": round(sum(best_genre_entry[1]) / len(best_genre_entry[1]), 2),
            "count": len(best_genre_entry[1]),
        } if best_genre_entry else None,
        "avg_release_year": avg_year,
        "longest_streak": longest_streak if rated_dates else 0,
        "albums_this_year": albums_this_year,
        "total_10s": total_10s,
    }


@router.get("/artists")
def artist_stats(user_id: int = Depends(viewable_user_id), before_date: Optional[date] = None, session: Session = Depends(get_session)):
    q = (
        select(Song)
        .join(Album, Song.album_id == Album.id)
        .where(Album.user_id == user_id)
        .where(Song.score.is_not(None))
    )
    if before_date:
        q = q.where(Album.date_rated <= before_date)
    songs = session.exec(q).all()

    by_artist: dict[str, list[float]] = defaultdict(list)
    for s in songs:
        if s.artist:
            by_artist[s.artist].append(s.score)

    result = []
    for artist, scores in by_artist.items():
        count = len(scores)
        avg = sum(scores) / count
        bangs = [s for s in scores if s >= BANG_THRESHOLD]
        skips = [s for s in scores if s < SKIP_THRESHOLD]
        a_scores = [compute_a_score(s) for s in scores]
        avg_a = sum(a_scores) / count

        # SAR: sum of (a_score - replacement_level); replacement = 6.0 a_score equiv
        replacement = compute_a_score(6.0)
        sar = sum(a - replacement for a in a_scores if a > replacement)

        # aCI: coefficient of variation (lower = more consistent)
        try:
            stdev = statistics.stdev(scores) if count > 1 else 0
            a_ci = (stdev / avg * 100) if avg else 0
        except Exception:
            a_ci = 0

        result.append({
            "artist": artist,
            "count": count,
            "avg_song_score": round(avg, 4),
            "wavg_song_score": round(avg_a, 4),
            "a_ci": round(a_ci, 4),
            "sar": round(sar, 4),
            "sar_ps": round(sar / count, 6) if count else 0,
            "skip_pct": round(len(skips) / count, 4),
            "bang_pct": round(len(bangs) / count, 4),
        })

    return sorted(result, key=lambda x: x["sar"], reverse=True)


@router.get("/genre-scores")
def genre_scores(user_id: int = Depends(viewable_user_id), session: Session = Depends(get_session)):
    """Per-album scores grouped by genre, for KDE plots."""
    albums = session.exec(
        select(Album)
        .where(Album.status == "rated")
        .where(Album.score.is_not(None))
        .where(Album.user_id == user_id)
    ).all()
    by_genre: dict[str, list[float]] = defaultdict(list)
    for a in albums:
        if a.genre and a.score is not None:
            by_genre[a.genre].append(round(a.score, 4))
    return [{"genre": g, "scores": scores} for g, scores in sorted(by_genre.items())]


@router.get("/year-by-year")
def year_by_year(user_id: int = Depends(viewable_user_id), session: Session = Depends(get_session)):
    albums = session.exec(
        select(Album)
        .where(Album.status == "rated")
        .where(Album.score.is_not(None))
        .where(Album.user_id == user_id)
    ).all()

    by_year: dict[int, list[Album]] = defaultdict(list)
    for a in albums:
        if a.year:
            by_year[a.year].append(a)

    return {
        year: [
            {"album_name": a.album_name, "artist": a.artist, "score": a.score}
            for a in sorted(albums, key=lambda x: x.score or 0, reverse=True)
        ]
        for year, albums in sorted(by_year.items(), reverse=True)
    }


@router.get("/scatter")
def scatter_data(user_id: int = Depends(viewable_user_id), before_date: Optional[date] = None, session: Session = Depends(get_session)):
    def album_ext(a: Album):
        if any(v is None for v in [a.theme, a.replay_value, a.production, a.distinctness]):
            return None
        return (0.25 * a.theme + 0.15 * a.replay_value + 0.15 * a.production + 0.05 * a.distinctness) / 0.60

    all_albums_q = select(Album).where(Album.user_id == user_id)
    all_albums = session.exec(all_albums_q).all()

    if before_date:
        rated_albums = [a for a in all_albums if a.status == "rated" and a.date_rated and a.date_rated <= before_date]
        eligible_ids = {a.id for a in rated_albums}
    else:
        rated_albums = [a for a in all_albums if a.status == "rated"]
        eligible_ids = {a.id for a in all_albums}

    user_album_ids = [a.id for a in all_albums]

    _count_rows = session.exec(
        select(Song.album_id, func.count(Song.id).label("n")).group_by(Song.album_id)
    ).all()
    _song_counts: dict[int, int] = {r[0]: r[1] for r in _count_rows}

    _scored_rows = session.exec(
        select(Song.album_id, Song.score)
        .where(Song.score.is_not(None))
        .where(Song.album_id.in_(user_album_ids))
    ).all()
    _album_scores: dict[int, list[float]] = defaultdict(list)
    for _aid, _sc in _scored_rows:
        if _aid in eligible_ids:
            _album_scores[_aid].append(_sc)

    by_artist: dict[str, dict] = {}
    for a in (rated_albums if before_date else all_albums):
        if not before_date and a.status != "rated" and _song_counts.get(a.id, 0) > 6:
            continue
        if before_date and a.id not in eligible_ids:
            continue
        art = a.artist
        if art not in by_artist:
            by_artist[art] = {"songs": [], "ext_vals": [], "genres": []}
        by_artist[art]["songs"].extend(_album_scores.get(a.id, []))
    for a in rated_albums:
        art = a.artist
        if art not in by_artist:
            by_artist[art] = {"songs": [], "ext_vals": [], "genres": []}
        ext = album_ext(a)
        if ext is not None:
            by_artist[art]["ext_vals"].append(ext)
        if a.genre:
            by_artist[art]["genres"].append(a.genre)

    rows = []
    for art, d in by_artist.items():
        if not d["songs"]:
            continue
        s = d["songs"]
        e = d["ext_vals"]
        avg_song = sum(s) / len(s)
        avg_ext = sum(e) / len(e) if e else None
        primary_genre = max(set(d["genres"]), key=d["genres"].count) if d["genres"] else None
        rows.append({
            "artist": art,
            "avg_song_score": avg_song,
            "avg_external": avg_ext,
            "genre": primary_genre,
            "song_count": len(s),
            "consistency_idx": round(100 * statistics.stdev(s), 2) if len(s) > 1 else None,
            "song_plus": None,
            "w_song_plus": None,
            "consistency_plus": None,
        })

    # Song+ — avg song score indexed against the league (100 = average)
    lg_song = [r["avg_song_score"] for r in rows]
    if len(lg_song) > 1:
        lg_avg_song = statistics.mean(lg_song)
        lg_std_song = statistics.stdev(lg_song)
        if lg_std_song:
            for r in rows:
                r["song_plus"] = round(100 + 10 * (r["avg_song_score"] - lg_avg_song) / lg_std_song, 1)

    # wSong+ — needs both axes
    rows_w = [r for r in rows if r["avg_external"] is not None]
    if len(rows_w) > 1:
        combined = [r["avg_song_score"] * 0.60 + r["avg_external"] * 0.40 for r in rows_w]
        lg_avg_w = statistics.mean(combined)
        lg_std_w = statistics.stdev(combined)
        for r, c in zip(rows_w, combined):
            if lg_std_w:
                r["w_song_plus"] = round(100 + 10 * (c - lg_avg_w) / lg_std_w, 1)

    # Consistency+
    cis = [r["consistency_idx"] for r in rows if r["consistency_idx"] is not None]
    if len(cis) > 1:
        lg_avg_ci = statistics.mean(cis)
        lg_std_ci = statistics.stdev(cis)
        for r in rows:
            if r["consistency_idx"] is not None and lg_std_ci:
                r["consistency_plus"] = round(100 - 10 * (r["consistency_idx"] - lg_avg_ci) / lg_std_ci, 1)

    points = [
        {
            "artist": r["artist"],
            "avg_song_score": round(r["avg_song_score"], 4),
            "avg_external": round(r["avg_external"], 4) if r["avg_external"] is not None else None,
            "genre": r["genre"],
            "song_count": r["song_count"],
            "song_plus": r["song_plus"],
            "w_song_plus": r["w_song_plus"],
            "consistency_plus": r["consistency_plus"],
        }
        for r in rows
    ]

    both = [p for p in points if p["avg_external"] is not None]
    mean_song = round(statistics.mean(p["avg_song_score"] for p in points), 4) if points else None
    mean_ext = round(statistics.mean(p["avg_external"] for p in both), 4) if both else None

    return {"points": points, "mean_song": mean_song, "mean_external": mean_ext}


# An artist needs this many tagged albums in a scope before their genres can be
# rolled up from it; below that the sample says more about which records the
# scope happens to hold than about the artist.
ARTIST_GENRE_MIN_ALBUMS = 1


def _artist_genres(albums: list[Album]) -> tuple[str | None, list[str]]:
    """An artist's genres, rolled up from their albums within one scope.

    Ranked by how often each tag appears rather than taken from the best-rated
    record: a second genre should be the one that recurs, not the one attached
    to whichever album happened to score highest.
    """
    genre_votes: dict[str, int] = defaultdict(int)
    sub_votes: dict[str, int] = defaultdict(int)
    for a in albums:
        if a.genre:
            genre_votes[a.genre] += 1
        for sub in (a.sub_genre1, a.sub_genre2, a.sub_genre3):
            if sub:
                sub_votes[sub] += 1
    primary = max(genre_votes, key=genre_votes.get) if genre_votes else None
    subs = sorted(sub_votes, key=lambda k: (-sub_votes[k], k))[:3]
    return primary, subs


def _artist_album_rows(albums: list[Album], album_ext, song_counts: dict[int, int]) -> list[dict]:
    """One row per record, not per copy.

    A single-user scope has one copy of each album, so grouping is a no-op. A
    global scope holds every user's copy, and listing them raw would repeat the
    same album once per rater with a different score on each line. Collapsed on
    the same-record key and averaged, so the row reads as the userbase's score.
    The id kept is a real copy's — whichever sorts first — so the row still
    opens something.
    """
    groups: dict[str, list[Album]] = defaultdict(list)
    for a in albums:
        groups[f'{_same_record(a.album_name)}||{_same_record(a.artist)}'].append(a)

    rows: list[dict] = []
    for copies in groups.values():
        scored = [c for c in copies if c.score is not None]
        ext_vals = [e for c in copies if (e := album_ext(c)) is not None]
        ref = max(copies, key=lambda c: (c.score or 0))
        rows.append({
            "id": ref.id,
            "album_name": ref.album_name,
            "year": next((c.year for c in copies if c.year), None),
            "score": round(sum(c.score for c in scored) / len(scored), 4) if scored else None,
            "album_art_url": next((c.album_art_url for c in copies if c.album_art_url), None),
            "avg_external": round(sum(ext_vals) / len(ext_vals), 4) if ext_vals else None,
            "is_ep": song_counts.get(ref.id, 0) <= 6,
            "status": ref.status,
            "rater_count": len(scored),
        })
    return sorted(rows, key=lambda r: r["score"] or 0, reverse=True)


def _artist_payload(session: Session, artist_name: str, all_albums_any_status: list[Album]) -> dict:
    """Everything the artist page shows, computed over whatever scope it's given.

    The whole pipeline below — the per-artist league table, the empirical-Bayes
    shrinkage on bang/skip, the + metrics, the ranks and percentiles — derives
    from this one list. Hand it one user's albums and the numbers are that
    user's; hand it every album in Pressd and the same code produces the
    userbase's, ranked against a global league table rather than a personal one.
    That symmetry is the point: the two populations can't drift apart, because
    there is only one implementation.
    """
    def album_ext(a: Album):
        if any(v is None for v in [a.theme, a.replay_value, a.production, a.distinctness]):
            return None
        return (
            (0.25 * a.theme + 0.15 * a.replay_value + 0.15 * a.production + 0.05 * a.distinctness)
            / 0.60
        )

    from .albums import artist_in_album

    all_albums = [a for a in all_albums_any_status if a.status == "rated"]
    artist_albums = [a for a in all_albums if artist_in_album(a, artist_name)]
    all_artist_albums = [a for a in all_albums_any_status if artist_in_album(a, artist_name)]

    user_album_ids = [a.id for a in all_albums_any_status]

    _count_rows = session.exec(
        select(Song.album_id, func.count(Song.id).label("n")).group_by(Song.album_id)
    ).all()
    _song_counts: dict[int, int] = {r[0]: r[1] for r in _count_rows}

    _scored_rows = session.exec(
        select(Song.album_id, Song.score)
        .where(Song.score.is_not(None))
        .where(Song.album_id.in_(user_album_ids))
    ).all()
    _album_scores: dict[int, list[float]] = defaultdict(list)
    for _aid, _sc in _scored_rows:
        _album_scores[_aid].append(_sc)

    song_scores = [
        score
        for a in all_artist_albums
        if a.status == "rated" or _song_counts.get(a.id, 0) <= 6
        for score in _album_scores.get(a.id, [])
    ]
    song_count = len(song_scores)
    avg_song_score = sum(song_scores) / song_count if song_scores else None

    ext_vals = [e for a in artist_albums if (e := album_ext(a)) is not None]
    avg_external = sum(ext_vals) / len(ext_vals) if ext_vals else None

    bangs = [s for s in song_scores if s >= BANG_THRESHOLD]
    skips = [s for s in song_scores if s < SKIP_THRESHOLD]
    bang_pct = len(bangs) / song_count if song_count else None
    skip_pct = len(skips) / song_count if song_count else None

    by_artist_songs: dict[str, list[float]] = defaultdict(list)
    for a in all_albums_any_status:
        if a.status == "rated" or _song_counts.get(a.id, 0) <= 6:
            scores = _album_scores.get(a.id)
            if scores:
                by_artist_songs[a.artist].extend(scores)

    # How much of this scope's listening the artist accounts for, overall and
    # within their own genre. Ranked on songs rated rather than albums: an
    # artist with three records everyone has played through outranks one with
    # eight nobody finished, which is the sense of "most rated" people mean.
    _genre_of: dict[str, str] = {}
    for a in all_albums_any_status:
        if a.artist and a.genre and a.artist not in _genre_of:
            _genre_of[a.artist] = a.genre
    _this_genre = _genre_of.get(artist_name) or next(
        (a.genre for a in all_artist_albums if a.genre), None
    )

    def _rank_within(pool: list[str]) -> tuple[int | None, int]:
        ordered = sorted(pool, key=lambda k: (-len(by_artist_songs[k]), k.lower()))
        lowered = artist_name.strip().lower()
        for i, k in enumerate(ordered):
            if k.strip().lower() == lowered:
                return i + 1, len(ordered)
        return None, len(ordered)

    _all_artists = [k for k, v in by_artist_songs.items() if v]
    popularity_rank, popularity_of = _rank_within(_all_artists)
    if _this_genre:
        genre_rank, genre_rank_of = _rank_within(
            [k for k in _all_artists if _genre_of.get(k) == _this_genre]
        )
    else:
        genre_rank, genre_rank_of = None, 0

    by_artist_ext: dict[str, list[float]] = defaultdict(list)
    for a in all_albums:
        if (e := album_ext(a)) is not None:
            by_artist_ext[a.artist].append(e)

    SMALL_SAMPLE = 15

    scatter_rows = []
    for art in by_artist_songs:
        s = by_artist_songs[art]
        e = by_artist_ext.get(art, [])
        n = len(s)
        bang_n = sum(1 for x in s if x >= BANG_THRESHOLD)
        skip_n = sum(1 for x in s if x < SKIP_THRESHOLD)
        scatter_rows.append({
            "artist": art,
            "n": n,
            "avg_song_score": sum(s) / n,
            "avg_external": sum(e) / len(e) if e else None,
            "bang_pct": bang_n / n,
            "skip_pct": skip_n / n,
            "bang_n": bang_n,
            "skip_n": skip_n,
            "consistency_idx": round(100 * statistics.stdev(s), 2) if len(s) > 1 else None,
            "song_plus": None,
            "w_song_plus": None,
            "consistency_plus": None,
        })

    # ── Empirical Bayes shrinkage for Bang% and Skip% ──────────────────────────
    def eb_kappa(proportions: list[float]) -> float:
        if len(proportions) < 2:
            return 1.0
        mu  = statistics.mean(proportions)
        var = statistics.variance(proportions)
        denom = mu * (1 - mu) - var
        return max(1.0, mu * (1 - mu) / var - 1) if denom > 0 else 1.0

    bang_props = [r["bang_pct"] for r in scatter_rows]
    skip_props = [r["skip_pct"] for r in scatter_rows]
    mu_bang, kappa_bang = statistics.mean(bang_props) if bang_props else 0, eb_kappa(bang_props)
    mu_skip, kappa_skip = statistics.mean(skip_props) if skip_props else 0, eb_kappa(skip_props)

    for r in scatter_rows:
        n = r["n"]
        r["adj_bang_pct"] = (r["bang_n"] + mu_bang * kappa_bang) / (n + kappa_bang)
        r["adj_skip_pct"] = (r["skip_n"] + mu_skip * kappa_skip) / (n + kappa_skip)

    lg_song_scores = [r["avg_song_score"] for r in scatter_rows]
    lg_avg_song = statistics.mean(lg_song_scores) if lg_song_scores else 0
    lg_std_song = statistics.stdev(lg_song_scores) if len(lg_song_scores) > 1 else None

    for r in scatter_rows:
        if lg_std_song:
            r["song_plus"] = 100 + 10 * (r["avg_song_score"] - lg_avg_song) / lg_std_song

    rows_w = [r for r in scatter_rows if r["avg_external"] is not None]
    if len(rows_w) > 1:
        lg_combined = [r["avg_song_score"] * 0.60 + r["avg_external"] * 0.40 for r in rows_w]
        lg_avg_w = statistics.mean(lg_combined)
        lg_std_w = statistics.stdev(lg_combined)
        for r, comb in zip(rows_w, lg_combined):
            if lg_std_w:
                r["w_song_plus"] = 100 + 10 * (comb - lg_avg_w) / lg_std_w

    lg_ci = [r["consistency_idx"] for r in scatter_rows if r["consistency_idx"] is not None]
    if len(lg_ci) > 1:
        lg_avg_ci = statistics.mean(lg_ci)
        lg_std_ci = statistics.stdev(lg_ci)
        for r in scatter_rows:
            if r["consistency_idx"] is not None and lg_std_ci:
                r["consistency_plus"] = 100 - 10 * (r["consistency_idx"] - lg_avg_ci) / lg_std_ci

    this_row = next((r for r in scatter_rows if r["artist"] == artist_name), None)

    song_plus        = round(this_row["song_plus"],        1) if this_row and this_row["song_plus"]        else None
    w_song_plus      = round(this_row["w_song_plus"],      1) if this_row and this_row["w_song_plus"]      else None
    consistency_plus = round(this_row["consistency_plus"], 1) if this_row and this_row["consistency_plus"] else None

    def pct_rank(pool: list, v) -> int | None:
        if v is None or not pool:
            return None
        return round(sum(1 for x in pool if x < v) / len(pool) * 100)

    all_sp   = [r["song_plus"]        for r in scatter_rows if r["song_plus"]        is not None]
    all_wsp  = [r["w_song_plus"]      for r in scatter_rows if r["w_song_plus"]      is not None]
    all_ext  = [r["avg_external"]     for r in scatter_rows if r["avg_external"]     is not None]
    all_ci   = [r["consistency_idx"]  for r in scatter_rows if r["consistency_idx"]  is not None]
    all_cp   = [r["consistency_plus"] for r in scatter_rows if r["consistency_plus"] is not None]
    all_bang = [r["adj_bang_pct"] for r in scatter_rows]
    all_skip = [r["adj_skip_pct"] for r in scatter_rows]

    percentiles = {
        "avg_song_score":   pct_rank(lg_song_scores, this_row["avg_song_score"]    if this_row else None),
        "song_plus":        pct_rank(all_sp,          this_row["song_plus"]         if this_row else None),
        "w_song_plus":      pct_rank(all_wsp,         this_row["w_song_plus"]       if this_row else None),
        "avg_external":     pct_rank(all_ext,         this_row["avg_external"]      if this_row else None),
        "bang_pct":         pct_rank(all_bang,        this_row["adj_bang_pct"]      if this_row else None),
        "skip_pct":         pct_rank(all_skip,        this_row["adj_skip_pct"]      if this_row else None),
        "consistency_idx":  pct_rank(all_ci,          this_row["consistency_idx"]   if this_row else None),
        "consistency_plus": pct_rank(all_cp,          this_row["consistency_plus"]  if this_row else None),
    }

    ranked_song = sorted(
        [r for r in scatter_rows if r["n"] >= SMALL_SAMPLE],
        key=lambda r: r["avg_song_score"], reverse=True,
    )
    ranked_ext = sorted(
        [r for r in scatter_rows if r["avg_external"] is not None and r["n"] >= SMALL_SAMPLE],
        key=lambda r: r["avg_external"], reverse=True,
    )

    song_score_rank = next(
        (i + 1 for i, r in enumerate(ranked_song) if r["artist"] == artist_name), None
    )
    external_rank = next(
        (i + 1 for i, r in enumerate(ranked_ext) if r["artist"] == artist_name), None
    )

    # Placements on the two + metrics, ranked off the values already computed
    # above for every artist (same qualifying cut as the other leaderboards).
    ranked_sp = sorted(
        [r for r in scatter_rows if r.get("song_plus") is not None and r["n"] >= SMALL_SAMPLE],
        key=lambda r: r["song_plus"], reverse=True,
    )
    ranked_wsp = sorted(
        [r for r in scatter_rows if r.get("w_song_plus") is not None and r["n"] >= SMALL_SAMPLE],
        key=lambda r: r["w_song_plus"], reverse=True,
    )
    song_plus_rank = next(
        (i + 1 for i, r in enumerate(ranked_sp) if r["artist"] == artist_name), None
    )
    w_song_plus_rank = next(
        (i + 1 for i, r in enumerate(ranked_wsp) if r["artist"] == artist_name), None
    )

    for r in scatter_rows:
        r["avg_song_score"] = round(r["avg_song_score"], 4)
        if r["avg_external"] is not None:
            r["avg_external"] = round(r["avg_external"], 4)

    genre, subgenres = _artist_genres(all_artist_albums)

    return {
        "artist": artist_name,
        "genre": genre,
        "subgenres": subgenres,
        "song_count": song_count,
        "album_count": len(artist_albums),
        "avg_song_score": round(avg_song_score, 4) if avg_song_score else None,
        "avg_external": round(avg_external, 4) if avg_external else None,
        "small_sample": song_count < SMALL_SAMPLE,
        "bang_pct": round(bang_pct, 4) if bang_pct is not None else None,
        "skip_pct": round(skip_pct, 4) if skip_pct is not None else None,
        "consistency_idx": this_row["consistency_idx"] if this_row else None,
        "consistency_plus": consistency_plus,
        "song_plus": song_plus,
        "w_song_plus": w_song_plus,
        "song_score_rank": song_score_rank,
        "song_score_rank_of": len(ranked_song),
        "external_rank": external_rank,
        "external_rank_of": len(ranked_ext),
        "song_plus_rank": song_plus_rank,
        "song_plus_rank_of": len(ranked_sp),
        "w_song_plus_rank": w_song_plus_rank,
        "w_song_plus_rank_of": len(ranked_wsp),
        "percentiles": percentiles,
        "song_scores": song_scores,
        # Ranked within whatever scope this payload was built over — the user's
        # own library for population='me', the whole site for 'global'.
        "popularity_rank": popularity_rank,
        "popularity_of": popularity_of,
        "genre_popularity_rank": genre_rank,
        "genre_popularity_of": genre_rank_of,
        "popularity_genre": _this_genre,
        "albums": _artist_album_rows(
            [a for a in all_artist_albums if a.status == "rated" or len(_album_scores.get(a.id, [])) <= 6],
            album_ext,
            _song_counts,
        ),
        "all_artists": scatter_rows,
    }


def _artist_track_scores(
    session: Session, artist_name: str, albums: list[Album]
) -> dict[object, dict]:
    """Every scored track of this artist within a scope, keyed so the same song
    lines up across libraries.

    The key is track_id where the catalogs agreed on one and a normalised title
    otherwise — the same rule global_rating.py uses to pool a record across
    editions. Keeping the two identical is what stops "Money Trees" on a deluxe
    reissue from being counted as a different song from the one on the original.
    """
    from .albums import artist_in_album

    ids = [a.id for a in albums if artist_in_album(a, artist_name)]
    if not ids:
        return {}

    rows = session.exec(
        select(Song.title, Song.score, Song.track_id)
        .where(Song.album_id.in_(ids))
        .where(Song.score.is_not(None))
    ).all()

    out: dict[object, dict] = {}
    for title, score, track_id in rows:
        key = track_id if track_id is not None else ("t:" + (title or "").strip().lower())
        slot = out.setdefault(key, {"title": title, "scores": []})
        slot["scores"].append(score)
    return out


def _artist_song_gaps(
    session: Session, artist_name: str, mine: list[Album], user_id: int
) -> list[dict]:
    """Per-song: your score against everyone else's for the same track.

    Everyone *else* — the pooled figure excludes your own rating. Including it
    would dilute the very gap the chart is drawing, and worst on the tracks that
    matter most: with two raters your score is half the number you're being
    compared against, so a real disagreement reads as half of itself.

    Tracks nobody else has rated are dropped rather than shown at a gap of zero.
    You are not a crowd to disagree with, and a row of zeroes would crowd out
    the genuine splits.
    """
    mine_tracks = _artist_track_scores(session, artist_name, mine)
    if not mine_tracks:
        return []
    others = _artist_track_scores(
        session,
        artist_name,
        session.exec(select(Album).where(Album.user_id != user_id)).all(),
    )

    gaps = []
    for key, m in mine_tracks.items():
        pooled = others.get(key)
        if not pooled:
            continue
        yours = sum(m["scores"]) / len(m["scores"])
        theirs = sum(pooled["scores"]) / len(pooled["scores"])
        gaps.append({
            "title": m["title"],
            "mine": round(yours, 2),
            "theirs": round(theirs, 2),
            "diff": round(yours - theirs, 2),
            "raters": len(pooled["scores"]),
        })
    # Biggest disagreement first; the client decides how many to draw.
    gaps.sort(key=lambda g: abs(g["diff"]), reverse=True)
    return gaps


def _artist_catalog_art(session: Session, artist_name: str, limit: int = 10) -> list[dict]:
    """Cover art for this artist from anywhere in Press'd, newest first.

    The header fan used to draw only from your own library, so an artist you'd
    rated once — or hadn't rated at all — got no covers. Someone else almost
    always holds the record, and its art is the same art.

    Matched on the album's primary artist rather than artist_in_album: that
    helper also walks featured credits, which would need every album in the
    table loaded to answer. Cover art doesn't warrant a full scan, and a
    record's own artist is who it's filed under anyway.
    """
    rows = session.exec(
        select(Album.album_name, Album.album_art_url, Album.year)
        # Contains rather than equals: the payload matches with artist_in_album,
        # which also walks featured and extra credits, and an exact match on the
        # primary artist column disagreed with it — an artist whose albums are
        # filed under a joint credit came back with no covers at all.
        .where(Album.artist.ilike(f"%{artist_name}%"))
        .where(Album.album_art_url.is_not(None))
    ).all()

    seen: dict[str, dict] = {}
    for name, art, year in rows:
        key = (name or "").strip().lower()
        if key and key not in seen:
            seen[key] = {"album_name": name, "album_art_url": art, "year": year}
    return sorted(seen.values(), key=lambda r: -(r["year"] or 0))[:limit]


@router.get("/artist/{artist_name}/similar")
def similar_artist_comparisons(
    artist_name: str,
    limit: int = Query(12, ge=1, le=40),
    user_id: int = Depends(viewable_user_id),
    session: Session = Depends(get_session),
):
    """Other artists in the same corner of your library, each with the one track
    you and Press'd disagree about most.

    "Cluster" here means shared canonical genre, ranked by how many subgenres
    also overlap. genre_clustering.py exists but is an offline UMAP/HDBSCAN pass
    over Essentia features that was never wired into the app — nothing persists
    a cluster id, so genre is the closest thing the stored data supports. If
    that script ever lands in the schema, this is the one place to repoint.

    Built from two queries rather than per-artist ones: computing gaps for a
    dozen artists a call at a time meant two round trips each, over the whole
    album table.
    """
    from .albums import artist_in_album

    mine = session.exec(select(Album).where(Album.user_id == user_id)).all()
    target = [a for a in mine if artist_in_album(a, artist_name)]
    if not target:
        return []

    def tags(albums: list[Album]) -> tuple[str | None, set[str]]:
        genres = [a.genre for a in albums if a.genre]
        subs = {s for a in albums for s in (a.sub_genre1, a.sub_genre2, a.sub_genre3) if s}
        primary = Counter(genres).most_common(1)[0][0] if genres else None
        return primary, subs

    want_genre, want_subs = tags(target)
    if not want_genre:
        return []

    # Candidates: your other artists sharing that genre.
    by_artist: dict[str, list[Album]] = defaultdict(list)
    for a in mine:
        if a.artist and a.artist.lower() != artist_name.lower():
            by_artist[a.artist].append(a)
    candidates = {}
    for name, albums in by_artist.items():
        g, subs = tags(albums)
        if g == want_genre:
            candidates[name] = len(want_subs & subs)
    if not candidates:
        return []

    def track_key(title: str | None, track_id) -> object:
        return track_id if track_id is not None else ("t:" + (title or "").strip().lower())

    # One pass for yours, one for everyone else's.
    def scored(where_mine: bool):
        q = (
            select(Album.artist, Song.title, Song.score, Song.track_id)
            .join(Song, Song.album_id == Album.id)
            .where(Song.score.is_not(None))
            .where(Album.artist.in_(list(candidates)))
        )
        q = q.where(Album.user_id == user_id) if where_mine else q.where(Album.user_id != user_id)
        return session.exec(q).all()

    mine_by: dict[tuple, list[float]] = defaultdict(list)
    titles: dict[tuple, str] = {}
    for artist, title, score, tid in scored(True):
        k = (artist, track_key(title, tid))
        mine_by[k].append(score)
        titles.setdefault(k, title)

    others_by: dict[tuple, list[float]] = defaultdict(list)
    for artist, title, score, tid in scored(False):
        others_by[(artist, track_key(title, tid))].append(score)

    # Biggest split per artist.
    best: dict[str, dict] = {}
    for k, my_scores in mine_by.items():
        theirs = others_by.get(k)
        if not theirs:
            continue
        artist = k[0]
        diff = (sum(my_scores) / len(my_scores)) - (sum(theirs) / len(theirs))
        if artist not in best or abs(diff) > abs(best[artist]["diff"]):
            best[artist] = {"title": titles[k], "diff": round(diff, 2)}

    meta = {
        m.artist: m.image_url
        for m in session.exec(
            select(ArtistMeta).where(ArtistMeta.artist.in_(list(best)))
        ).all()
    }

    rows = [
        {
            "artist": name,
            "image_url": meta.get(name),
            "shared_subgenres": candidates[name],
            "top_gap": gap,
        }
        for name, gap in best.items()
    ]
    # Closest neighbours first, then the loudest disagreement among them — the
    # cell is only worth a tap if the note under it says something.
    rows.sort(key=lambda r: (-r["shared_subgenres"], -abs(r["top_gap"]["diff"])))
    return rows[:limit]


@router.get("/artist/{artist_name}")
def artist_detail(
    artist_name: str,
    population: str = Query("me", pattern="^(me|global|both)$"),
    user_id: int = Depends(viewable_user_id),
    session: Session = Depends(get_session),
):
    """The artist page, for one library or for all of Pressd.

    population=me      → this user's ratings, ranked among their own artists
    population=global  → every user's ratings pooled, ranked globally
    population=both    → the user's payload with the global percentiles and
                         headline metrics attached, so the comparison view can
                         draw two markers per bar off a single request

    Pooled rather than averaged per user: a global percentile should be a
    property of the whole rating set, and averaging each user's average would
    let someone with three rated songs move it as far as someone with three
    hundred.
    """
    def scope_global() -> list[Album]:
        return session.exec(select(Album)).all()

    if population == "global":
        g = _artist_payload(session, artist_name, scope_global())
        g["catalog_art"] = _artist_catalog_art(session, artist_name)
        return g

    mine = session.exec(select(Album).where(Album.user_id == user_id)).all()
    payload = _artist_payload(session, artist_name, mine)
    # Every mode's header reads this, so it isn't gated on population.
    payload["catalog_art"] = _artist_catalog_art(session, artist_name)
    if population == "both":
        g = _artist_payload(session, artist_name, scope_global())
        # Only what the comparison actually draws — the full global payload
        # would double the response for albums and song_scores the compare view
        # never reads.
        payload["global"] = {
            "percentiles": g["percentiles"],
            "avg_song_score": g["avg_song_score"],
            "avg_external": g["avg_external"],
            "song_plus": g["song_plus"],
            "w_song_plus": g["w_song_plus"],
            "consistency_plus": g["consistency_plus"],
            "bang_pct": g["bang_pct"],
            "skip_pct": g["skip_pct"],
            "song_count": g["song_count"],
            "album_count": g["album_count"],
            "small_sample": g["small_sample"],
            "genre": g["genre"],
            "subgenres": g["subgenres"],
        }
        # Per-track splits, for the compare view's gap chart. Only computed for
        # 'both' — it is the one view that reads it.
        payload["song_gaps"] = _artist_song_gaps(session, artist_name, mine, user_id)
        # Everyone else's raw song scores, so the compare view can lay their
        # distribution under yours. Excludes you for the same reason the gaps
        # do: two curves that both contain your ratings would overlap by
        # construction, and the overlap is the thing being read.
        others = _artist_track_scores(
            session,
            artist_name,
            session.exec(select(Album).where(Album.user_id != user_id)).all(),
        )
        payload["global"]["song_scores"] = [s for t in others.values() for s in t["scores"]]
    return payload


@router.get("/genres")
def genre_breakdown(user_id: int = Depends(viewable_user_id), session: Session = Depends(get_session)):
    albums = session.exec(
        select(Album).where(Album.status == "rated").where(Album.user_id == user_id)
    ).all()

    by_genre: dict[str, list[float]] = defaultdict(list)
    for a in albums:
        g = a.genre or "Unknown"
        if a.score is not None:
            by_genre[g].append(a.score)

    return [
        {
            "genre": genre,
            "count": len(scores),
            "avg_score": round(sum(scores) / len(scores), 4),
        }
        for genre, scores in sorted(by_genre.items(), key=lambda x: len(x[1]), reverse=True)
    ]


@router.get("/analysis")
def analysis(user_id: int = Depends(viewable_user_id), session: Session = Depends(get_session)):
    import anthropic

    rated_albums = session.exec(
        select(Album)
        .where(Album.status == "rated", Album.user_id == user_id, Album.score.is_not(None))
        .options(selectinload(Album.songs))
    ).all()

    to_listen = session.exec(
        select(Album).where(Album.status == "to_listen", Album.user_id == user_id)
    ).all()

    seven_days_ago = date.today() - timedelta(days=7)
    recent = [a for a in rated_albums if a.date_rated and a.date_rated >= seven_days_ago]

    # Per-genre averages
    by_genre: dict[str, list[float]] = defaultdict(list)
    for a in rated_albums:
        if a.genre and a.score is not None:
            by_genre[a.genre].append(a.score)

    # Per-artist song averages
    artist_songs: dict[str, list[float]] = defaultdict(list)
    all_songs_flat = []
    for a in rated_albums:
        for s in a.songs:
            if s.score is not None:
                artist_songs[a.artist].append(s.score)
                all_songs_flat.append({
                    "title": s.title,
                    "album": a.album_name,
                    "artist": a.artist,
                    "score": s.score,
                    "date_rated": str(a.date_rated),
                })

    lines: list[str] = []
    lines.append(f"Total rated albums: {len(rated_albums)}, To-listen queue: {len(to_listen)}")

    lines.append("\n=== RATED ALBUMS (score | name | artist | genre | year | date rated) ===")
    for a in sorted(rated_albums, key=lambda x: x.score or 0, reverse=True):
        lines.append(f"{a.score:.2f} | {a.album_name} | {a.artist} | {a.genre or 'Unknown'} | {a.year or '?'} | {a.date_rated}")

    lines.append("\n=== GENRE AVERAGES ===")
    for g, scores in sorted(by_genre.items(), key=lambda x: sum(x[1])/len(x[1]), reverse=True):
        lines.append(f"{g}: {sum(scores)/len(scores):.2f} avg over {len(scores)} albums")

    lines.append("\n=== ARTIST SONG AVERAGES (≥5 songs) ===")
    for artist, scores in sorted(artist_songs.items(), key=lambda x: sum(x[1])/len(x[1]), reverse=True):
        if len(scores) >= 5:
            lines.append(f"{artist}: {sum(scores)/len(scores):.2f} avg over {len(scores)} songs")

    lines.append(f"\n=== RECENTLY RATED (last 7 days, {len(recent)} albums) ===")
    for a in recent:
        lines.append(f"{a.album_name} by {a.artist} — score: {a.score:.2f}")

    lines.append("\n=== TO-LISTEN QUEUE (first 20) ===")
    for a in to_listen[:20]:
        lines.append(f"{a.album_name} by {a.artist} | {a.genre or 'Unknown'}")

    lines.append("\n=== TOP 10 SONGS ===")
    for s in sorted(all_songs_flat, key=lambda x: x["score"], reverse=True)[:10]:
        lines.append(f"{s['score']:.1f} | {s['title']} | {s['artist']}")

    context = "\n".join(lines)

    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=500,
        messages=[{
            "role": "user",
            "content": (
                "You are analyzing a music fan's listening data from the Pressd app "
                "(a personal music rating tracker where 1–10 scores are given to songs and albums).\n\n"
                f"Here is their data:\n\n{context}\n\n"
                "Find exactly 3 interesting, specific, and surprising patterns or facts. "
                "Each should be concrete — mention real names and numbers. "
                "Make them feel like genuine discoveries, not generic observations. "
                "Keep each to 1–2 punchy sentences. "
                "Return ONLY a valid JSON array of 3 strings, no explanation:\n"
                '["insight one.", "insight two.", "insight three."]'
            ),
        }],
    )

    text = response.content[0].text.strip()
    # Strip markdown code fences if the model wraps in ```json
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()

    try:
        insights = json.loads(text)
        if not isinstance(insights, list):
            insights = [str(insights)]
    except Exception:
        insights = [line.strip().strip('"').strip("'").rstrip(",") for line in text.splitlines() if line.strip()][:3]

    return {"insights": insights}
