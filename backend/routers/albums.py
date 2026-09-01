import json
import re
from collections import defaultdict
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from sqlalchemy import func, text as _sql
from sqlalchemy.orm import selectinload
from datetime import date, datetime

from ..database import get_session
from ..deps import current_user, authorize_view, are_friends
from ..models import Album, Song, SongAudioFeatures, PressUser, Like, Comment
from ..scoring import compute_a_score, recompute_all_scores, BANG_THRESHOLD, SKIP_THRESHOLD
from ..global_rating import invalidate_cache as invalidate_global_ratings
from ..genres import GENRES, canonical_genre, canonical_subgenre
from ..trackkeys import _clean_album, match_title, same_album
from ..carryover import carryover_for_album
from ..threads import post_track_note, sync_review_post

router = APIRouter(prefix="/albums", tags=["albums"])


def _record_copies(session: Session, album_name: str, artist: str, *,
                   rated_only: bool = False, with_songs: bool = False) -> list[Album]:
    """Every user's copy of one record, matched on the same-recording key.

    Catalogs disagree about edition far more than about the record. Three users
    hold Drake's Take Care as 'Take Care', 'Take Care (Deluxe)' and 'Take Care
    (Deluxe Version)'; matching raw names made that three community albums with
    one rater each, none of which could offer a comparison. `_clean_album` is
    the key the charts already collapse on, and the same idea `match_title`
    applies to the tracks *inside* this payload — the album it hangs off was
    the one level still being matched literally.

    Filtered in Python because the key is a Python normalizer. The SQL prefilter
    on artist keeps the candidate set to one artist's catalogue, so this reads
    tens of rows rather than the table.
    """
    q = select(Album).where(
        func.lower(func.trim(Album.artist)) == (artist or "").strip().lower())
    if rated_only:
        q = q.where(Album.status == "rated", Album.score.is_not(None))
    if with_songs:
        q = q.options(selectinload(Album.songs))
    target = _clean_album(album_name)
    return [a for a in session.exec(q).all() if _clean_album(a.album_name) == target]

# Fields a client may set/change on an album; everything else (score, user_id,
# predicted_*) is server-controlled and must never come from the request body.
ALBUM_MUTABLE_FIELDS = {
    "album_name", "artist", "year", "status", "theme", "replay_value",
    "production", "distinctness", "genre", "sub_genre1", "sub_genre2",
    "sub_genre3", "spotify_id", "album_art_url", "total_tracks", "extra_artists",
}


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
    user_id: Optional[int] = Query(None),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    target_id = user_id if user_id is not None else user.id
    authorize_view(user, target_id, session)
    # Short releases (EPs/singles) are included everywhere; the frontend
    # renders an EP/Single tag to distinguish them from full albums
    q = select(Album).where(Album.user_id == target_id)
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


@router.get("/art-strip")
def art_strip(
    limit: int = Query(40, le=80),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Album art URLs from across the whole library (all users), for the
    onboarding conveyor. Art only — no titles, scores, or owners."""
    rows = session.exec(
        select(Album.album_art_url)
        .where(Album.album_art_url.is_not(None))
        .order_by(func.random())
        .limit(limit * 3)  # oversample: same album can exist for many users
    ).all()
    seen: set[str] = set()
    urls: list[str] = []
    for u in rows:
        if u not in seen:
            seen.add(u)
            urls.append(u)
        if len(urls) >= limit:
            break
    return urls


@router.get("/community-by-name")
def community_album_by_name(
    album_name: str = Query(...),
    artist: str = Query(...),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Community view for an album identified by name + artist rather than by a
    copy's id — how new releases arrive, since they may not be in Pressd yet."""
    source = next(iter(_record_copies(
        session, album_name, artist, with_songs=True)), None)
    return _community_payload(session, user, album_name, artist, source)


@router.get("/{album_id}")
def get_album(
    album_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    authorize_view(user, album.user_id, session)
    # Whether a comparison exists to make. Counted here rather than left to the
    # client, which would otherwise have to pull the whole pooled community
    # payload — tracks and all — just to learn whether the number is zero.
    others = len({
        a.user_id for a in _record_copies(
            session, album.album_name or "", album.artist or "", rated_only=True)
        if a.user_id is not None and a.user_id != user.id
    })
    songs = [s.model_dump() for s in album.songs]
    # A score this user already gave the same recording on a single or an EP,
    # offered as a prefill for the rating flow. Only computed for the owner —
    # a friend viewing the album has no use for it — and only when something is
    # still unscored, which keeps it off the hot path for finished records.
    # See backend/carryover.py for why a shared track_id alone is not enough.
    if album.user_id == user.id and any(s["score"] is None for s in songs):
        carried = carryover_for_album(session, album_id, user.id)
        for s in songs:
            hit = carried.get(s["id"])
            if hit:
                s["carried_score"] = hit["score"]
                s["carried_from_album_id"] = hit["from_album_id"]
                s["carried_from_album_name"] = hit["from_album_name"]
    return {
        **album.model_dump(),
        "others_rater_count": others,
        "songs": songs,
    }


@router.post("/")
def create_album(
    album: Album,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    # Ownership and computed fields are server-controlled — never trust the body.
    album.user_id = user.id
    album.score = None
    album.predicted_score = None
    album.predicted_theme = None
    album.predicted_distinctness = None
    album.predicted_replay = None
    album.predicted_song_mean = None
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
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    if album.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not your album")

    for key, value in data.items():
        if key in ALBUM_MUTABLE_FIELDS:
            setattr(album, key, value)

    # Not in ALBUM_MUTABLE_FIELDS: it names a row in another table, so it is
    # checked rather than assigned. Only a track on this album can be its top
    # song; null clears the pick and restores the highest-score default.
    if "top_song_id" in data:
        chosen = data["top_song_id"]
        if chosen is None:
            album.top_song_id = None
        else:
            owned = session.exec(
                select(Song.id).where(Song.album_id == album.id, Song.id == chosen)
            ).first()
            if owned is None:
                raise HTTPException(status_code=400, detail="That song is not on this album")
            album.top_song_id = chosen

    if data.get("status") == "rated":
        album.date_rated = date.today()

    session.add(album)
    session.commit()
    session.refresh(album)

    if any(k in data for k in ("theme", "replay_value", "production", "distinctness", "status")):
        recompute_all_scores(session)
        invalidate_global_ratings()
        session.refresh(album)

    if data.get("status") == "rated":
        _queue_song_repredictions(user.id)

    if data.get("status") == "to_listen" and album.predicted_score is None:
        _queue_predictions(album.id)

    # Same shape GET returns. A bare `album` serialises its columns but not its
    # songs, so a client that renders from the PATCH response — the share card
    # does — saw a record with no tracks at all.
    return {**album.model_dump(), "songs": [s.model_dump() for s in album.songs]}


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


# The tagger's vocabulary lives in backend.genres alongside the synonym map,
# so the list Claude is prompted with can't drift from the one that normalizes
# what the scraper and importers send.
_GENRE_LIST = GENRES

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
    genre = canonical_genre(data.get("genre"))
    genre = genre if genre in _GENRE_LIST else None
    subgenres = [canonical_subgenre(s) for s in data.get("subgenres", [])
                 if isinstance(s, str) and s.strip()][:3]
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


def _queue_song_repredictions(user_id: int):
    """Spawn a background thread that retrains the song score model on the
    newly enlarged library and refreshes predicted_song_mean for every
    to_listen album (composite scores included). Runs on each new rating.

    The user id is required, not defaulted: this used to call through with
    repredict_all_song_means' default of 1, so whoever rated an album, it was
    always user 1's model that got retrained and user 1's queue that got
    refreshed."""
    import threading, sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
    def _run():
        try:
            from song_score_model import repredict_all_song_means
            from ..database import engine
            with engine.connect() as con:
                repredict_all_song_means(con, user_id)
        except Exception as e:
            print(f"[_queue_song_repredictions] failed for user {user_id}: {e}")
    threading.Thread(target=_run, daemon=True).start()


@router.post("/import")
def import_album(
    data: dict,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    user_id = user.id

    def _return_existing(existing: Album) -> dict:
        # Backfill art the original import didn't have (e.g. first added
        # manually or before Cover Art Archive had the album) — otherwise the
        # NULL invites the iTunes enrichment to guess, and a re-import with
        # the right cover is the best possible source.
        if not existing.album_art_url and data.get("cover_url"):
            existing.album_art_url = data["cover_url"]
            session.add(existing)
            session.commit()
            session.refresh(existing)
        return {
            **existing.model_dump(),
            "songs": [s.model_dump() for s in existing.songs],
            "already_existed": True,
        }

    # Return existing album if already imported — check Spotify ID first, then name+artist (scoped per user)
    if data.get("spotify_id"):
        existing = session.exec(
            select(Album)
            .where(Album.spotify_id == data["spotify_id"])
            .where(Album.user_id == user_id)
        ).first()
        if existing:
            return _return_existing(existing)
    else:
        existing = _find_users_copy(session, user_id, data.get("album_name"), data.get("artist"))
        if existing:
            return _return_existing(existing)

    extra = data.get("extra_artists")
    album = Album(
        album_name=data["album_name"],
        artist=data["artist"],
        year=data.get("year"),
        status=data.get("status", "to_listen"),
        album_art_url=data.get("cover_url"),
        spotify_id=data.get("spotify_id"),
        total_tracks=data.get("total_tracks"),
        genre=canonical_genre(data.get("genre")),
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

    _link_tracks(session, album.id)

    if album.status == "to_listen":
        _queue_predictions(album.id)

    if not album.genre:
        _queue_genre_tagging(album.id, album.artist, album.album_name, album.year)

    return {
        **album.model_dump(),
        "songs": [s.model_dump() for s in album.songs],
        "already_existed": False,
    }


def _link_tracks(session: Session, album_id: int):
    """Resolve global track ids for an album's songs (shared-audio dedup):
    if any user already imported + analyzed the same recording, its audio is
    reused and the nightly ingest never downloads it again. Never fails the
    import — the worker's sync_tracks() is the backstop."""
    from sqlalchemy import text as _sql
    from ..trackkeys import track_key
    try:
        rows = session.execute(_sql(
            "SELECT s.id, COALESCE(NULLIF(s.artist, ''), a.artist), s.title, s.duration_ms"
            " FROM song s JOIN album a ON a.id = s.album_id"
            " WHERE s.album_id = :aid AND s.track_id IS NULL"), {"aid": album_id}).fetchall()
        for song_id, artist, title, dur in rows:
            key = track_key(artist or "", title or "")
            hit = session.execute(_sql(
                "SELECT id, duration_ms FROM track WHERE track_key = :k"),
                {"k": key}).fetchone()
            if hit and dur and hit[1] and abs(dur - hit[1]) > 10_000:
                key = f"{key}||d{dur // 1000}"   # same name, different recording
                hit = session.execute(_sql(
                    "SELECT id, duration_ms FROM track WHERE track_key = :k"),
                    {"k": key}).fetchone()
            if hit:
                tid = hit[0]
            else:
                a_norm, t_norm = key.split("||")[0], key.split("||")[1]
                tid = session.execute(_sql(
                    "INSERT INTO track (track_key, artist_norm, title_norm, duration_ms, created_at)"
                    " VALUES (:k, :a, :t, :d, NOW()) ON CONFLICT (track_key) DO UPDATE"
                    " SET track_key = EXCLUDED.track_key RETURNING id"),
                    {"k": key, "a": a_norm, "t": t_norm, "d": dur}).scalar()
            session.execute(_sql("UPDATE song SET track_id = :tid WHERE id = :sid"),
                            {"tid": tid, "sid": song_id})
        session.commit()
    except Exception as e:
        session.rollback()
        print(f"[_link_tracks] album {album_id} failed: {e}")


@router.get("/{album_id}/report")
def album_report(
    album_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    album = session.exec(
        select(Album).where(Album.id == album_id).options(selectinload(Album.songs))
    ).first()
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    authorize_view(user, album.user_id, session)

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


def _clone_album(session: Session, source: Album, target_user_id: int, status: str = "to_listen", **extra) -> Album:
    """Clone an album and its songs into another user's library with fresh
    scores. Reuses each song's track_id so shared audio features carry over,
    and the copy is the exact same album (metadata + tracklist) as the source."""
    new_album = Album(
        album_name=source.album_name,
        artist=source.artist,
        year=source.year,
        genre=canonical_genre(source.genre),
        sub_genre1=canonical_subgenre(source.sub_genre1),
        sub_genre2=canonical_subgenre(source.sub_genre2),
        sub_genre3=canonical_subgenre(source.sub_genre3),
        album_art_url=source.album_art_url,
        spotify_id=source.spotify_id,
        total_tracks=source.total_tracks,
        extra_artists=source.extra_artists,
        status=status,
        user_id=target_user_id,
        **extra,
    )
    session.add(new_album)
    session.flush()
    _copy_songs(session, source, new_album)
    return new_album


def _copy_songs(session: Session, source: Album, target: Album) -> int:
    """Clone a tracklist onto someone else's copy and return how many landed.

    Scores are left empty — `Song.score` defaults to None — so the tracklist
    arrives unrated no matter what the source's own ratings were. Each song
    keeps the source's `track_id`, so any audio already analyzed for that
    recording is reused rather than downloaded again.
    """
    n = 0
    for s in source.songs:
        session.add(Song(
            title=s.title,
            track_number=s.track_number,
            duration_ms=s.duration_ms,
            explicit=s.explicit,
            spotify_id=s.spotify_id,
            spotify_popularity=s.spotify_popularity,
            artist=s.artist,
            track_id=s.track_id,
            album_id=target.id,
        ))
        n += 1
    return n


# Long enough for a real reason, short enough to read on a shelf row without
# becoming a review — that's what the review field is for.
RECOMMENDATION_NOTE_MAX = 280


@router.post("/{album_id}/recommend")
def recommend_album(
    album_id: int,
    data: dict,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    source = session.get(Album, album_id)
    if not source:
        raise HTTPException(status_code=404, detail="Album not found")
    friend_id = data.get("friend_id")
    recommender_id = user.id
    recommender = user
    if not friend_id or friend_id == user.id or not are_friends(session, user.id, friend_id):
        raise HTTPException(status_code=403, detail="You can only recommend to friends")

    # Optional — a recommendation with nothing said about it is still a
    # recommendation, so an empty note stores as null rather than "".
    note = (data.get("note") or "").strip()
    if len(note) > RECOMMENDATION_NOTE_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"Keep your note to {RECOMMENDATION_NOTE_MAX} characters or fewer",
        )
    note = note or None

    # The tracklist is half of what's being sent. Without one the recipient
    # gets a shell that opens into a rating screen it can never submit, which
    # is worse than the recommendation simply not going through.
    if not source.songs:
        raise HTTPException(
            status_code=409,
            detail="That album has no tracklist yet, so there's nothing to send. Open it once to resolve its tracks, then try again.",
        )

    existing = _find_users_copy(session, friend_id, source.album_name, source.artist)

    if existing:
        existing.recommended_by = recommender_id
        existing.recommended_by_name = recommender.name
        existing.recommended_at = datetime.utcnow()
        # Overwritten wholesale, including back to null: this stamp records the
        # latest recommendation, so a new one sending no note must not leave the
        # previous sender's words attached to it.
        existing.recommendation_note = note

        # The copy they already held may be a shell — added by name, or cloned
        # before the source had a tracklist. Stamping it and stopping there is
        # what produced albums that opened straight into an unsubmittable
        # rating screen: no tracks means the "every track needs a score" guard
        # can never be satisfied. A recommendation should arrive as complete as
        # a fresh one, so fill in whatever's missing.
        added = 0
        if not existing.songs:
            added = _copy_songs(session, source, existing)

        # Anything they've actually engaged with is left alone — a rating or a
        # part-finished pass is theirs, and a recommendation is not a reason to
        # reset it. Only an untouched copy gets shelved under To Listen.
        untouched = existing.score is None and existing.status != "listening"
        if untouched:
            existing.status = "to_listen"

        # Metadata the shell was missing, so it renders like any other album.
        if not existing.album_art_url:
            existing.album_art_url = source.album_art_url
        if existing.year is None:
            existing.year = source.year
        if not existing.genre:
            existing.genre = canonical_genre(source.genre)
            existing.sub_genre1 = canonical_subgenre(source.sub_genre1)
            existing.sub_genre2 = canonical_subgenre(source.sub_genre2)
            existing.sub_genre3 = canonical_subgenre(source.sub_genre3)
        if not existing.total_tracks:
            existing.total_tracks = source.total_tracks or added or None

        session.add(existing)
        session.commit()

        if added:
            _link_tracks(session, existing.id)
        # A shelf item without a prediction is missing the number To Listen
        # sorts on, so backfill it once there are tracks to predict from.
        if untouched and existing.predicted_score is None and (added or existing.songs):
            _queue_predictions(existing.id)
        if not existing.genre:
            _queue_genre_tagging(existing.id, existing.artist, existing.album_name, existing.year)
        return {"ok": True, "already_existed": True, "tracks_added": added}

    new_album = _clone_album(
        session, source, friend_id, status="to_listen",
        recommended_by=recommender_id,
        recommended_by_name=recommender.name,
        recommended_at=datetime.utcnow(),
        recommendation_note=note,
    )
    session.commit()
    session.refresh(new_album)
    _link_tracks(session, new_album.id)
    _queue_predictions(new_album.id)
    if not new_album.genre:
        _queue_genre_tagging(new_album.id, new_album.artist, new_album.album_name, new_album.year)
    return {"ok": True, "already_existed": False}


def _find_users_copy(session: Session, user_id: int, album_name: str, artist: str,
                     *, with_songs: bool = False) -> Album | None:
    """The copy this user already holds of a given record, if any.

    Matched with `same_album` rather than string equality. Two people adding
    one album from different catalogs get different strings for it — "Nothing
    Was The Same (Deluxe)" against "Nothing Was the Same (Deluxe)", credits
    spelled out or not — and an `==` lookup answers "no copy" to all of them,
    which is how a second copy of a record you already own gets created.

    Narrowed in SQL by user, compared in Python because `same_album` is a
    predicate, not a clause. A single user's library is small enough that the
    scan costs nothing.
    """
    q = select(Album).where(Album.user_id == user_id)
    if with_songs:
        q = q.options(selectinload(Album.songs))
    for candidate in session.exec(q).all():
        if same_album(album_name, artist, candidate.album_name, candidate.artist):
            return candidate
    return None


_HAS_FEAT = re.compile(r"\b(feat\.?|featuring|ft\.?)\b", re.I)


def _fuller_title(current: str, candidate: str) -> str:
    """Pick the spelling to show once two copies' titles have merged.

    Copies disagree on whether a title carries its features. The credited
    spelling is strictly more informative — "All Me (feat. 2 Chainz & Big
    Sean)" tells you who is on the track, "All Me" doesn't — so it wins.
    Neither having credits leaves the seeded title alone rather than churning
    between equivalent spellings.
    """
    if _HAS_FEAT.search(candidate or "") and not _HAS_FEAT.search(current or ""):
        return candidate
    return current


def _community_payload(session: Session, user: PressUser, album_name: str, artist: str, source: Album | None):
    """The userbase's view of an album, averaged across everyone who rated it.

    Entry points that aren't tied to a person — trending, charts, new releases
    — land here instead of on some individual's copy, which would otherwise
    403 whenever the copy belonged to a stranger. Returns averaged album score,
    factors and per-track scores, plus the caller's own numbers so the client
    can offer a comparison without a second round trip. An album nobody has
    rated yet comes back with null averages and a zero rater count rather than
    a 404 — that's a valid state for a fresh release.
    """
    copies = _record_copies(session, album_name, artist,
                            rated_only=True, with_songs=True)

    def avg(vals):
        vals = [v for v in vals if v is not None]
        return round(sum(vals) / len(vals), 2) if vals else None

    # Titles are matched on the shared same-recording key, not raw punctuation:
    # one copy spells the feat-credit out and another doesn't, and a local
    # normalizer that ignored that split single tracks into two rows.
    norm = match_title

    # Seed the tracklist from the most complete copy so unrated tracks still
    # show, then fold every copy's scores into it.
    base = max(copies, key=lambda c: len(c.songs)) if copies else source
    buckets: dict[str, dict] = {}
    for s in sorted(base.songs, key=lambda s: s.track_number or 0) if base else []:
        buckets[norm(s.title)] = {
            "title": s.title, "track_number": s.track_number,
            "scores": [], "others": [], "your_score": None,
        }
    for c in copies:
        for s in c.songs:
            if s.score is None:
                continue
            key = norm(s.title)
            b = buckets.get(key)
            if b is None:
                b = buckets.setdefault(key, {
                    "title": s.title, "track_number": s.track_number,
                    "scores": [], "others": [], "your_score": None,
                })
            else:
                b["title"] = _fuller_title(b["title"], s.title)
            b["scores"].append(s.score)
            if c.user_id == user.id:
                b["your_score"] = s.score
            else:
                # Kept apart from `scores` so a side-by-side can put you on one
                # side and everyone else on the other. Pooling both into one
                # figure and labelling it "Pressd users" put the reader inside
                # the group they were being measured against, which halves every
                # gap on a two-rater record.
                b["others"].append(s.score)

    tracks = [
        {
            "title": b["title"],
            "track_number": b["track_number"],
            "avg_score": avg(b["scores"]),
            "rater_count": len(b["scores"]),
            "others_avg_score": avg(b["others"]),
            "others_rater_count": len(b["others"]),
            "your_score": b["your_score"],
        }
        for b in sorted(buckets.values(), key=lambda b: (b["track_number"] or 999, b["title"]))
    ]

    mine = next((c for c in copies if c.user_id == user.id), None)
    # Your copy at any status — an unrated one still supplies the id to rate
    # and the per-user prediction, neither of which live on the averages.
    mine_any = mine or next(
        (a for a in _record_copies(session, album_name, artist)
         if a.user_id == user.id), None)
    ref = source or mine_any or (copies[0] if copies else None)
    pick = lambda attr: next(
        (getattr(c, attr) for c in copies if getattr(c, attr)),
        getattr(ref, attr) if ref else None,
    )

    return {
        "album_id": ref.id if ref else None,
        "album_name": ref.album_name if ref else album_name,
        "artist": ref.artist if ref else artist,
        "year": pick("year"),
        "album_art_url": pick("album_art_url"),
        "genre": pick("genre"),
        "sub_genre1": pick("sub_genre1"),
        "sub_genre2": pick("sub_genre2"),
        "sub_genre3": pick("sub_genre3"),
        "rater_count": len({c.user_id for c in copies if c.user_id is not None}),
        # Everyone but you. rater_count includes your own copy, so on a record
        # only you have rated it reads 1 and the pooled average is your own
        # score — which let the compare view offer a side-by-side of you
        # against yourself and report exact agreement.
        "others_rater_count": len(
            {c.user_id for c in copies if c.user_id is not None and c.user_id != user.id}
        ),
        "others_avg_score": avg([c.score for c in copies if c.user_id != user.id]),
        "avg_score": avg([c.score for c in copies]),
        "avg_theme": avg([c.theme for c in copies]),
        "avg_replay_value": avg([c.replay_value for c in copies]),
        "avg_production": avg([c.production for c in copies]),
        "avg_distinctness": avg([c.distinctness for c in copies]),
        "tracks": tracks,
        "your_album_id": mine_any.id if mine_any else None,
        "your_status": mine_any.status if mine_any else None,
        "predicted_score": mine_any.predicted_score if mine_any else None,
        # Off your own copy, not the pooled record: a recommendation is made to
        # one person, so it has no meaning on the userbase view of an album
        # except as "this is why it's on your shelf".
        "recommended_by_name": mine_any.recommended_by_name if mine_any else None,
        "recommendation_note": mine_any.recommendation_note if mine_any else None,
        "you": None if mine is None else {
            "album_id": mine.id,
            "score": mine.score,
            "theme": mine.theme,
            "replay_value": mine.replay_value,
            "production": mine.production,
            "distinctness": mine.distinctness,
        },
    }


@router.get("/{album_id}/community")
def community_album(
    album_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    source = session.get(Album, album_id)
    if not source:
        raise HTTPException(status_code=404, detail="Album not found")
    return _community_payload(session, user, source.album_name, source.artist, source)


@router.post("/{album_id}/copy")
def copy_album(
    album_id: int,
    status: str = Query("to_listen", pattern="^(to_listen|listening)$"),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Add an existing album (e.g. a friend's copy shown in the feed) to the
    current user's library as the exact same album — metadata and tracklist —
    through the same import pipeline as a fresh add (track linking, predictions,
    genre tagging). Returns the user's existing copy if they already have it."""
    source = session.exec(
        select(Album).where(Album.id == album_id).options(selectinload(Album.songs))
    ).first()
    if not source:
        raise HTTPException(status_code=404, detail="Album not found")

    existing = None
    if source.spotify_id:
        existing = session.exec(
            select(Album)
            .where(Album.spotify_id == source.spotify_id, Album.user_id == user.id)
            .options(selectinload(Album.songs))
        ).first()
    if not existing:
        existing = _find_users_copy(session, user.id, source.album_name, source.artist, with_songs=True)
    if existing:
        return {**existing.model_dump(), "songs": [s.model_dump() for s in existing.songs], "already_existed": True}

    new_album = _clone_album(session, source, user.id, status=status)
    session.commit()
    session.refresh(new_album)
    _link_tracks(session, new_album.id)
    if new_album.status == "to_listen":
        _queue_predictions(new_album.id)
    if not new_album.genre:
        _queue_genre_tagging(new_album.id, new_album.artist, new_album.album_name, new_album.year)
    return {**new_album.model_dump(), "songs": [s.model_dump() for s in new_album.songs], "already_existed": False}


MAX_REVIEW_LEN = 20000


@router.put("/{album_id}/review")
def save_review(
    album_id: int,
    data: dict,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Write or update the long-form review on your own album rating.

    An empty body clears the review. `review_at` is stamped on the first write
    and left untouched on edits, so editing an old review doesn't re-surface it
    to the top of friends' feeds.
    """
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    if album.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not your album")

    body = (data.get("body") or "").strip()
    if not body:
        album.review = None
        album.review_at = None
    else:
        if not album.review or not album.review_at:
            album.review_at = datetime.utcnow()  # first write only
        album.review = body[:MAX_REVIEW_LEN]
    session.add(album)
    session.commit()
    # A review is the record's discussion starting, so it belongs in the thread
    # rather than only on this copy of the album. See backend/threads.py.
    sync_review_post(session, album)
    return {
        "review": album.review,
        "review_at": album.review_at.isoformat() if album.review_at else None,
    }


@router.get("/{album_id}/track-threads")
def track_threads(
    album_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Note counts and a one-line preview for every track on the album, in one
    call (PLAN_discussions.md §10).

    Deliberately not a request per track: a 25-track record would fire 25 on
    mount, and the tracklist wants all of it at once or none of it.

    `locked` is the same gate `deps.thread_access` applies — a track the viewer
    has not rated is not previewed, since the preview is the spoiler.
    """
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    authorize_view(user, album.user_id, session)

    rows = session.execute(_sql("""
        SELECT s.id, s.track_id,
               COALESCE(cnt.n, 0) AS notes,
               top.body,
               (s.score IS NOT NULL OR :rated) AS unlocked
        FROM song s
        LEFT JOIN LATERAL (
            SELECT COUNT(*) AS n FROM post p JOIN thread t ON t.id = p.thread_id
            WHERE t.subject_type = 'track' AND t.subject_key = s.track_id::text
              AND p.deleted_at IS NULL AND p.kind <> 'system'
        ) cnt ON TRUE
        LEFT JOIN LATERAL (
            SELECT p.body FROM post p JOIN thread t ON t.id = p.thread_id
            WHERE t.subject_type = 'track' AND t.subject_key = s.track_id::text
              AND p.deleted_at IS NULL AND p.kind <> 'system' AND NOT p.is_spoiler
            ORDER BY (p.like_count - p.dislike_count) DESC, p.created_at DESC
            LIMIT 1
        ) top ON TRUE
        WHERE s.album_id = :aid AND s.track_id IS NOT NULL
    """), {"aid": album_id, "rated": album.status == "rated"}).fetchall()

    return {
        str(r[0]): {
            "track_id": r[1],
            "note_count": r[2] or 0,
            # Withheld behind the gate, not merely dimmed: a preview of what
            # people said about a track you have not reached is the spoiler the
            # whole rule exists to prevent.
            "preview": (r[3] if r[4] else None),
            "locked": not r[4],
        }
        for r in rows
    }


@router.post("/{album_id}/thoughts")
def publish_thoughts(
    album_id: int,
    data: dict,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Publish what was written during the rating flow: a review, and a note on
    any number of tracks (PLAN_discussions.md §7.3).

    One request, and the fan-out happens here. The client must not loop over
    tracks firing a post each: a dropped connection halfway through would lose
    writing the user cannot get back, and there is no sensible way to resume it.

    Deliberately separate from the rating write, and called after it. A note is
    a consequence of a rating, never a condition of one — if every post in here
    failed, the rating would still stand, and the response says exactly what did
    not land so the client can offer it back rather than silently dropping it.
    """
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    if album.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not your album")

    review = (data.get("review") or "").strip()
    review_posted = False
    if review or album.review:
        if review:
            if not album.review or not album.review_at:
                album.review_at = datetime.utcnow()   # first write only
            album.review = review[:MAX_REVIEW_LEN]
        else:
            album.review, album.review_at = None, None
        session.add(album)
        session.commit()
        sync_review_post(session, album)
        review_posted = bool(review)

    songs = {s.id: s for s in album.songs}
    posted, failed = 0, []
    for note in data.get("notes") or []:
        song = songs.get(note.get("song_id"))
        if not song:
            failed.append(note.get("song_id"))
            continue
        if post_track_note(session, user.id, song, note.get("body") or ""):
            posted += 1
        elif (note.get("body") or "").strip():
            # Only a note that had something in it and still did not land counts
            # as a failure; an empty one was a deletion and did its job.
            failed.append(song.id)

    return {"review_posted": review_posted, "notes_posted": posted, "failed": failed}


@router.delete("/{album_id}/review")
def delete_review(
    album_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    if album.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not your album")
    album.review = None
    album.review_at = None
    session.add(album)
    session.commit()
    sync_review_post(session, album)
    return {"ok": True}


@router.post("/enrich-covers")
def enrich_covers(
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Fill in missing album_art_url values by searching iTunes."""
    import requests as _requests

    albums = session.exec(
        select(Album)
        .where(Album.user_id == user.id)
        .where(Album.album_art_url.is_(None))
    ).all()

    def _norm(s: str | None) -> str:
        return re.sub(r"[^a-z0-9]", "", (s or "").lower())

    def _itunes_search(term: str, norm_name: str, norm_artists: list[str]) -> str | None:
        resp = _requests.get(
            "https://itunes.apple.com/search",
            params={"term": term, "entity": "album", "limit": 5},
            timeout=6,
        )
        results = resp.json().get("results", [])
        # Title AND artist must both match — a same-titled album by a different
        # artist is worse than no art at all. Artist compares as a substring in
        # either direction so combined credits ("Bruno Mars, Anderson .Paak &
        # Silk Sonic") still match. No fall-back-to-first-result.
        for r in results:
            if _norm(r.get("collectionName")) != norm_name:
                continue
            r_artist = _norm(r.get("artistName"))
            if any(na and (na in r_artist or r_artist in na) for na in norm_artists):
                raw = r.get("artworkUrl100", "")
                return raw.replace("100x100bb", "600x600bb") if raw else None
        return None

    updated = 0
    for album in albums:
        try:
            norm_name = _norm(album.album_name)
            norm_artists = [_norm(album.artist)]
            if album.extra_artists:
                try:
                    norm_artists += [_norm(a) for a in json.loads(album.extra_artists)]
                except (json.JSONDecodeError, TypeError):
                    pass
            # Pass 1: album + artist (handles most cases)
            url = _itunes_search(f"{album.album_name} {album.artist}", norm_name, norm_artists)
            # Pass 2: album name only (handles multi-artist credits like Silk
            # Sonic, where the credited artist breaks the search term but the
            # artist check above still verifies the result)
            if not url:
                url = _itunes_search(album.album_name, norm_name, norm_artists)
            if url:
                album.album_art_url = url
                session.add(album)
                updated += 1
        except Exception:
            continue

    if updated:
        session.commit()
    return {"updated": updated, "total_missing": len(albums)}


@router.delete("/{album_id}")
def delete_album(
    album_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    if album.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not your album")
    for like in session.exec(select(Like).where(Like.album_id == album_id)).all():
        session.delete(like)
    for comment in session.exec(select(Comment).where(Comment.album_id == album_id)).all():
        session.delete(comment)
    for song in album.songs:
        af = session.exec(select(SongAudioFeatures).where(SongAudioFeatures.song_id == song.id)).first()
        if af:
            session.delete(af)
        session.delete(song)
    session.delete(album)
    session.commit()
    return {"ok": True}
