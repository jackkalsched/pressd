from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select, func
from sqlalchemy.orm import selectinload
from collections import defaultdict
import statistics

from ..database import get_session
from ..models import Album, Song
from ..scoring import BANG_THRESHOLD, SKIP_THRESHOLD, compute_a_score, get_factor_stats

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/factor-stats")
def factor_stats(session: Session = Depends(get_session)):
    stats = get_factor_stats(session)
    return {k: list(v) for k, v in stats.items()}


@router.get("/summary")
def summary(user_id: int = Query(1), session: Session = Depends(get_session)):
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
    }


@router.get("/artists")
def artist_stats(user_id: int = Query(1), session: Session = Depends(get_session)):
    songs = session.exec(
        select(Song)
        .join(Album, Song.album_id == Album.id)
        .where(Album.user_id == user_id)
        .where(Song.score.is_not(None))
    ).all()

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
def genre_scores(user_id: int = Query(1), session: Session = Depends(get_session)):
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
def year_by_year(user_id: int = Query(1), session: Session = Depends(get_session)):
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
def scatter_data(user_id: int = Query(1), session: Session = Depends(get_session)):
    def album_ext(a: Album):
        if any(v is None for v in [a.theme, a.replay_value, a.production, a.distinctness]):
            return None
        return (0.25 * a.theme + 0.15 * a.replay_value + 0.15 * a.production + 0.05 * a.distinctness) / 0.60

    all_albums = session.exec(select(Album).where(Album.user_id == user_id)).all()
    rated_albums = [a for a in all_albums if a.status == "rated"]

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
        _album_scores[_aid].append(_sc)

    by_artist: dict[str, dict] = {}
    for a in all_albums:
        if a.status != "rated" and _song_counts.get(a.id, 0) > 6:
            continue  # skip non-rated full albums
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
            "w_song_plus": None,
            "consistency_plus": None,
        })

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
            "w_song_plus": r["w_song_plus"],
            "consistency_plus": r["consistency_plus"],
        }
        for r in rows
    ]

    both = [p for p in points if p["avg_external"] is not None]
    mean_song = round(statistics.mean(p["avg_song_score"] for p in points), 4) if points else None
    mean_ext = round(statistics.mean(p["avg_external"] for p in both), 4) if both else None

    return {"points": points, "mean_song": mean_song, "mean_external": mean_ext}


@router.get("/artist/{artist_name}")
def artist_detail(artist_name: str, user_id: int = Query(1), session: Session = Depends(get_session)):
    def album_ext(a: Album):
        if any(v is None for v in [a.theme, a.replay_value, a.production, a.distinctness]):
            return None
        return (
            (0.25 * a.theme + 0.15 * a.replay_value + 0.15 * a.production + 0.05 * a.distinctness)
            / 0.60
        )

    from .albums import artist_in_album

    all_albums_any_status = session.exec(select(Album).where(Album.user_id == user_id)).all()
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

    for r in scatter_rows:
        r["avg_song_score"] = round(r["avg_song_score"], 4)
        if r["avg_external"] is not None:
            r["avg_external"] = round(r["avg_external"], 4)

    return {
        "artist": artist_name,
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
        "percentiles": percentiles,
        "song_scores": song_scores,
        "albums": [
            {
                "id": a.id,
                "album_name": a.album_name,
                "year": a.year,
                "score": a.score,
                "album_art_url": a.album_art_url,
                "avg_external": album_ext(a),
                "is_ep": _song_counts.get(a.id, 0) <= 6,
            }
            for a in sorted(
                [a for a in all_artist_albums if a.status == "rated" or len(_album_scores.get(a.id, [])) <= 6],
                key=lambda x: x.score or 0, reverse=True,
            )
        ],
        "all_artists": scatter_rows,
    }


@router.get("/genres")
def genre_breakdown(user_id: int = Query(1), session: Session = Depends(get_session)):
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
