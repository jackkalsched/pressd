import json
from collections import defaultdict
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from sqlalchemy import func
from sqlalchemy.orm import selectinload
from datetime import date

from ..database import get_session
from ..models import Album, Song, SongAudioFeatures, PressUser
from ..scoring import compute_a_score, recompute_all_scores, BANG_THRESHOLD, SKIP_THRESHOLD

router = APIRouter(prefix="/albums", tags=["albums"])


def artist_in_album(album: Album, name: str) -> bool:
    if album.artist == name:
        return True
    if album.extra_artists:
        try:
            return name in json.loads(album.extra_artists)
        except (json.JSONDecodeError, TypeError):
            pass
    return False


@router.get("/")
def list_albums(
    status: Optional[str] = Query(None),
    artist: Optional[str] = Query(None),
    album_name: Optional[str] = Query(None),
    genre: Optional[str] = Query(None),
    user_id: int = Query(1),
    session: Session = Depends(get_session),
):
    song_count = (
        select(func.count(Song.id))
        .where(Song.album_id == Album.id)
        .correlate(Album)
        .scalar_subquery()
    )
    q = select(Album).where(Album.user_id == user_id)
    # Only exclude short releases (singles/EPs) for rated albums; unrated albums may have no tracks yet
    if status not in ("to_listen", "listening"):
        q = q.where(song_count > 6)
    if status:
        q = q.where(Album.status == status)
    if genre:
        q = q.where(Album.genre == genre)
    if album_name:
        q = q.where(Album.album_name == album_name)
    albums = session.exec(q.order_by(Album.score.desc())).all()
    if artist:
        albums = [a for a in albums if artist_in_album(a, artist)]
    return albums


@router.get("/{album_id}")
def get_album(album_id: int, session: Session = Depends(get_session)):
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    return {**album.model_dump(), "songs": [s.model_dump() for s in album.songs]}


@router.post("/")
def create_album(album: Album, session: Session = Depends(get_session)):
    session.add(album)
    session.commit()
    session.refresh(album)
    if album.status == "to_listen" and album.predicted_score is None:
        _queue_predictions(album.id)
    return album


@router.patch("/{album_id}")
def update_album(
    album_id: int,
    data: dict,
    session: Session = Depends(get_session),
):
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")

    for key, value in data.items():
        if hasattr(album, key):
            setattr(album, key, value)

    if data.get("status") == "rated":
        album.date_rated = date.today()

    session.add(album)
    session.commit()
    session.refresh(album)

    if any(k in data for k in ("theme", "replay_value", "production", "distinctness", "status")):
        recompute_all_scores(session)
        session.refresh(album)

    if data.get("status") == "rated":
        _queue_recompute_predictions()

    if data.get("status") == "to_listen" and album.predicted_score is None:
        _queue_predictions(album.id)

    return album


def _queue_predictions(album_id: int):
    """Spawn a background thread to predict scores for a new to_listen album."""
    import threading, sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
    def _run():
        try:
            from theme_predictor.predict_single import predict_album
            predict_album(album_id)
        except Exception as e:
            print(f"[_queue_predictions] failed for album {album_id}: {e}")
    threading.Thread(target=_run, daemon=True).start()


_GENRE_LIST = [
    "Hip-Hop", "R&B", "Pop", "Rock", "Electronic", "Folk",
    "Singer-Songwriter", "Country", "Jazz", "Latin", "Afrobeats",
    "Classical", "Funk", "Disco", "Blues", "Gospel",
]

def _classify_genre_claude(artist: str, album_name: str, year: int | None) -> tuple[str | None, list[str]]:
    """Call Claude Haiku to classify main genre + up to 3 subgenres."""
    import json as _json, os as _os
    import anthropic as _anthropic
    client = _anthropic.Anthropic(api_key=_os.environ.get("ANTHROPIC_API_KEY"))
    year_str = f" ({year})" if year else ""
    prompt = (
        f'Album: "{album_name}" by {artist}{year_str}\n\n'
        f'Classify this album. Respond with JSON only, no explanation:\n'
        f'{{"genre": "<one of: {", ".join(_GENRE_LIST)}>", '
        f'"subgenres": ["<specific subgenre 1>", "<specific subgenre 2>", "<specific subgenre 3>"]}}'
    )
    resp = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=120,
        temperature=0,
        messages=[{"role": "user", "content": prompt}],
    )
    text = resp.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    data = _json.loads(text.strip())
    genre = data.get("genre") if data.get("genre") in _GENRE_LIST else None
    subgenres = [s for s in data.get("subgenres", []) if isinstance(s, str) and s.strip()][:3]
    return genre, subgenres


def _queue_genre_tagging(album_id: int, artist: str, album_name: str, year: int | None = None):
    """Spawn a background thread to classify genre/subgenres via Claude (Last.fm fallback for genre)."""
    import threading, sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
    def _run():
        try:
            from ..database import engine
            from sqlmodel import Session

            genre, subgenres = _classify_genre_claude(artist, album_name, year)

            # fallback: if Claude didn't return a valid genre, try Last.fm
            if not genre:
                try:
                    from generate_genres_lastfm import get_tags_for_album, infer_genres
                    tags = get_tags_for_album(album_id, artist, album_name)
                    genre, _ = infer_genres(tags)
                except Exception:
                    pass

            if not genre and not subgenres:
                return

            with Session(engine) as s:
                alb = s.get(Album, album_id)
                if alb:
                    if genre and not alb.genre:
                        alb.genre = genre
                    if len(subgenres) > 0 and not alb.sub_genre1:
                        alb.sub_genre1 = subgenres[0]
                    if len(subgenres) > 1 and not alb.sub_genre2:
                        alb.sub_genre2 = subgenres[1]
                    if len(subgenres) > 2 and not alb.sub_genre3:
                        alb.sub_genre3 = subgenres[2]
                    s.add(alb)
                    s.commit()
                    print(f"[genre_tagger] {artist} – {album_name}: genre={genre} subs={subgenres}")
        except Exception as e:
            print(f"[_queue_genre_tagging] failed for album {album_id}: {e}")
    threading.Thread(target=_run, daemon=True).start()


def _queue_recompute_predictions():
    """Spawn a background thread to refresh predictions for all unrated albums."""
    import threading, sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
    def _run():
        try:
            from theme_predictor.predict_single import recompute_all_predictions
            recompute_all_predictions()
        except Exception as e:
            print(f"[_queue_recompute_predictions] failed: {e}")
    threading.Thread(target=_run, daemon=True).start()


@router.post("/import")
def import_album(data: dict, user_id: int = Query(1), session: Session = Depends(get_session)):
    # Return existing album if already imported — check Spotify ID first, then name+artist (scoped per user)
    if data.get("spotify_id"):
        existing = session.exec(
            select(Album)
            .where(Album.spotify_id == data["spotify_id"])
            .where(Album.user_id == user_id)
        ).first()
        if existing:
            return {
                **existing.model_dump(),
                "songs": [s.model_dump() for s in existing.songs],
                "already_existed": True,
            }
    else:
        existing = session.exec(
            select(Album)
            .where(Album.album_name == data.get("album_name"))
            .where(Album.artist == data.get("artist"))
            .where(Album.user_id == user_id)
        ).first()
        if existing:
            return {
                **existing.model_dump(),
                "songs": [s.model_dump() for s in existing.songs],
                "already_existed": True,
            }

    extra = data.get("extra_artists")
    album = Album(
        album_name=data["album_name"],
        artist=data["artist"],
        year=data.get("year"),
        status=data.get("status", "to_listen"),
        album_art_url=data.get("cover_url"),
        spotify_id=data.get("spotify_id"),
        total_tracks=data.get("total_tracks"),
        genre=data.get("genre"),
        extra_artists=json.dumps(extra) if extra else None,
        user_id=user_id,
    )
    session.add(album)
    session.flush()

    for t in data.get("tracks", []):
        song = Song(
            title=str(t["title"]),
            track_number=t.get("track_number"),
            duration_ms=t.get("duration_ms"),
            explicit=t.get("explicit", False),
            spotify_id=t.get("spotify_id"),
            artist=t.get("artist", data["artist"]),
            album_id=album.id,
        )
        session.add(song)

    session.commit()
    session.refresh(album)

    if album.status == "to_listen":
        _queue_predictions(album.id)

    if not album.genre:
        _queue_genre_tagging(album.id, album.artist, album.album_name, album.year)

    return {
        **album.model_dump(),
        "songs": [s.model_dump() for s in album.songs],
        "already_existed": False,
    }


@router.get("/{album_id}/report")
def album_report(album_id: int, session: Session = Depends(get_session)):
    album = session.exec(
        select(Album).where(Album.id == album_id).options(selectinload(Album.songs))
    ).first()
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")

    sorted_songs = sorted(album.songs, key=lambda s: s.track_number or 0)
    rated_scores = [s.score for s in sorted_songs if s.score is not None]
    n_rated = len(rated_scores)
    bang_count = sum(1 for s in rated_scores if s >= BANG_THRESHOLD)
    skip_count = sum(1 for s in rated_scores if s < SKIP_THRESHOLD)
    bang_pct = bang_count / n_rated if n_rated else 0
    skip_pct = skip_count / n_rated if n_rated else 0

    # All rated album scores for distribution chart (scoped to same user)
    all_scores_sorted = sorted(
        session.exec(
            select(Album.score)
            .where(Album.status == "rated")
            .where(Album.score.is_not(None))
            .where(Album.user_id == album.user_id)
        ).all()
    )
    album_rank = sum(1 for s in all_scores_sorted if s > (album.score or -1)) + 1 if album.score else None

    import statistics as _stat

    # Build other-artists song pool (used as the "league" in both before/after)
    artist_name = album.artist

    # Load albums lean + targeted song queries (avoids transferring full song rows)
    all_albums_any = session.exec(select(Album).where(Album.user_id == album.user_id)).all()

    _user_album_ids = {a.id for a in all_albums_any}

    _count_rows = session.exec(
        select(Song.album_id, func.count(Song.id).label("n")).group_by(Song.album_id)
    ).all()
    _song_counts: dict[int, int] = {r[0]: r[1] for r in _count_rows if r[0] in _user_album_ids}

    _scored_rows = session.exec(
        select(Song.album_id, Song.score)
        .where(Song.score.is_not(None))
        .where(Song.album_id.in_(list(_user_album_ids)))
    ).all()
    _album_scores: dict[int, list[float]] = defaultdict(list)
    for _aid, _sc in _scored_rows:
        _album_scores[_aid].append(_sc)

    def _album_ext(a):
        if any(v is None for v in [a.theme, a.replay_value, a.production, a.distinctness]):
            return None
        return (0.25 * a.theme + 0.15 * a.replay_value + 0.15 * a.production + 0.05 * a.distinctness) / 0.60

    other_by_artist: dict[str, list] = defaultdict(list)
    _other_ext_raw: dict[str, list] = defaultdict(list)
    for a in all_albums_any:
        if artist_in_album(a, artist_name):
            continue
        if a.status == "rated" or _song_counts.get(a.id, 0) <= 6:
            scores = _album_scores.get(a.id)
            if scores:
                other_by_artist[a.artist].extend(scores)
        if a.status == "rated":
            ext = _album_ext(a)
            if ext is not None:
                _other_ext_raw[a.artist].append(ext)
    other_ext_avgs = {art: sum(v) / len(v) for art, v in _other_ext_raw.items() if v}

    def _artist_song_scores(exclude_id=None):
        scores = []
        for a in all_albums_any:
            if not artist_in_album(a, artist_name):
                continue
            if exclude_id and a.id == exclude_id:
                continue
            if a.status == "rated" or _song_counts.get(a.id, 0) <= 6:
                scores.extend(_album_scores.get(a.id) or [])
        return scores

    def _artist_ext_avg(exclude_id=None):
        vals = [_album_ext(a) for a in all_albums_any
                if artist_in_album(a, artist_name)
                and a.status == "rated"
                and (not exclude_id or a.id != exclude_id)
                and _album_ext(a) is not None]
        return sum(vals) / len(vals) if vals else None

    def _compute_stats(artist_songs, artist_ext_avg=None):
        n = len(artist_songs)
        _empty_pct = {"avg_song_score": None, "bang_pct": None, "skip_pct": None,
                      "w_song_plus": None, "consistency_plus": None}
        if n == 0:
            return {"avg_song_score": None, "bang_pct": None, "skip_pct": None,
                    "w_song_plus": None, "consistency_plus": None, "percentiles": _empty_pct}
        avg = sum(artist_songs) / n
        b   = sum(1 for s in artist_songs if s >= BANG_THRESHOLD) / n
        sk  = sum(1 for s in artist_songs if s < SKIP_THRESHOLD) / n
        ci  = 100 * _stat.stdev(artist_songs) if n > 1 else None

        league = {**other_by_artist, artist_name: artist_songs}

        def pct_rank(pool, val):
            if val is None or not pool:
                return None
            return round(sum(1 for x in pool if x < val) / len(pool) * 100)

        all_avgs = [sum(v) / len(v) for v in league.values() if v]
        all_b    = [sum(1 for x in v if x >= BANG_THRESHOLD) / len(v) for v in league.values() if v]
        all_sk   = [sum(1 for x in v if x < SKIP_THRESHOLD) / len(v) for v in league.values() if v]

        # Consistency+
        consistency_plus = None
        all_cp: list[float] = []
        all_ci_vals = [100 * _stat.stdev(v) for v in league.values() if len(v) > 1]
        if ci is not None and len(all_ci_vals) > 1:
            lg_avg_ci = _stat.mean(all_ci_vals)
            lg_std_ci = _stat.stdev(all_ci_vals)
            if lg_std_ci:
                all_cp = [100 - 10 * (c - lg_avg_ci) / lg_std_ci for c in all_ci_vals]
                consistency_plus = round(100 - 10 * (ci - lg_avg_ci) / lg_std_ci, 1)

        # wSong+
        w_song_plus = None
        all_wsp: list[float] = []
        if artist_ext_avg is not None:
            this_comb = avg * 0.60 + artist_ext_avg * 0.40
            comb_vals = []
            for art, songs in league.items():
                if not songs:
                    continue
                art_avg = sum(songs) / len(songs)
                ext = artist_ext_avg if art == artist_name else other_ext_avgs.get(art)
                if ext is not None:
                    comb_vals.append(art_avg * 0.60 + ext * 0.40)
            if len(comb_vals) > 1:
                lg_avg_w = _stat.mean(comb_vals)
                lg_std_w = _stat.stdev(comb_vals)
                if lg_std_w:
                    all_wsp = [100 + 10 * (c - lg_avg_w) / lg_std_w for c in comb_vals]
                    w_song_plus = round(100 + 10 * (this_comb - lg_avg_w) / lg_std_w, 1)

        return {
            "avg_song_score": round(avg, 4),
            "bang_pct": round(b, 4),
            "skip_pct": round(sk, 4),
            "w_song_plus": w_song_plus,
            "consistency_plus": consistency_plus,
            "percentiles": {
                "avg_song_score": pct_rank(all_avgs, avg),
                "bang_pct": pct_rank(all_b, b),
                "skip_pct": pct_rank(all_sk, sk),
                "w_song_plus": pct_rank(all_wsp, w_song_plus),
                "consistency_plus": pct_rank(all_cp, consistency_plus),
            },
        }

    # User-scoped bang/skip rate — use the already-loaded _album_scores for rated albums
    _rated_ids = {a.id for a in all_albums_any if a.status == "rated"}
    all_rated_song_scores = [sc for aid, sc in _scored_rows if aid in _rated_ids]
    n_all = len(all_rated_song_scores)
    avg_bang_pct = sum(1 for s in all_rated_song_scores if s >= BANG_THRESHOLD) / n_all if n_all else 0
    avg_skip_pct = sum(1 for s in all_rated_song_scores if s < SKIP_THRESHOLD) / n_all if n_all else 0

    return {
        "album": {
            "id": album.id,
            "album_name": album.album_name,
            "artist": album.artist,
            "year": album.year,
            "score": album.score,
            "album_art_url": album.album_art_url,
            "genre": album.genre,
            "extra_artists": json.loads(album.extra_artists) if album.extra_artists else [],
            "theme": album.theme,
            "replay_value": album.replay_value,
            "production": album.production,
            "distinctness": album.distinctness,
        },
        "songs": [
            {
                "title": s.title,
                "track_number": s.track_number,
                "score": s.score,
                "is_bang": s.score is not None and s.score >= BANG_THRESHOLD,
                "is_skip": s.score is not None and s.score < SKIP_THRESHOLD,
            }
            for s in sorted_songs
        ],
        "bang_count": bang_count,
        "skip_count": skip_count,
        "bang_pct": round(bang_pct, 4),
        "skip_pct": round(skip_pct, 4),
        "avg_bang_pct": round(avg_bang_pct, 4),
        "avg_skip_pct": round(avg_skip_pct, 4),
        "album_rank": album_rank,
        "album_rank_of": len(all_scores_sorted),
        "all_album_scores": all_scores_sorted,
        "artist_stats_after": _compute_stats(_artist_song_scores(), _artist_ext_avg()),
        "artist_stats_before": _compute_stats(_artist_song_scores(exclude_id=album_id), _artist_ext_avg(exclude_id=album_id)),
    }


@router.post("/{album_id}/recommend")
def recommend_album(album_id: int, data: dict, session: Session = Depends(get_session)):
    source = session.get(Album, album_id)
    if not source:
        raise HTTPException(status_code=404, detail="Album not found")
    friend_id = data.get("friend_id")
    recommender_id = data.get("recommender_id")
    recommender = session.get(PressUser, recommender_id)
    if not recommender:
        raise HTTPException(status_code=404, detail="Recommender not found")

    existing = session.exec(
        select(Album).where(
            Album.user_id == friend_id,
            Album.album_name == source.album_name,
            Album.artist == source.artist,
        )
    ).first()

    if existing:
        existing.recommended_by = recommender_id
        existing.recommended_by_name = recommender.name
        session.add(existing)
        session.commit()
        return {"ok": True, "already_existed": True}

    new_album = Album(
        album_name=source.album_name,
        artist=source.artist,
        year=source.year,
        genre=source.genre,
        sub_genre1=source.sub_genre1,
        sub_genre2=source.sub_genre2,
        sub_genre3=source.sub_genre3,
        album_art_url=source.album_art_url,
        spotify_id=source.spotify_id,
        total_tracks=source.total_tracks,
        extra_artists=source.extra_artists,
        status="to_listen",
        user_id=friend_id,
        recommended_by=recommender_id,
        recommended_by_name=recommender.name,
    )
    session.add(new_album)
    session.commit()
    return {"ok": True, "already_existed": False}


@router.delete("/{album_id}")
def delete_album(album_id: int, session: Session = Depends(get_session)):
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    for song in album.songs:
        af = session.exec(select(SongAudioFeatures).where(SongAudioFeatures.song_id == song.id)).first()
        if af:
            session.delete(af)
        session.delete(song)
    session.delete(album)
    session.commit()
    return {"ok": True}
