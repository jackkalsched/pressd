"""Bins — themed collections of records (docs/superpowers/specs/2026-11-11-bins-design.md).

v1 serves Pressd's curated bins, written only by worker/import_bin.py. Every
route is behind a signed-in caller, as the rest of the app is, and what it
says about the caller — progress, their copy, their predicted score — is
theirs alone. Other people appear only as an average and a rater count.

A bin points at records by `subject_key`, so a copy of any edition counts.
Adding from a bin makes an ordinary copy, through the same insert as an
import (albums.create_copy), from the tracklist the import tool stored on the
entry — no outbound call — and the copy doesn't remember the bin.
"""
import json
import threading
from collections import Counter

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from .. import bins as binlib
from ..database import get_session
from ..deps import current_user
from ..genres import canonical_genre
from ..models import Album, AlbumPrediction, Bin, BinEntry, PressUser, Song, SongPrediction
from ..scoring import predictions_unlocked
from ..trackkeys import album_key, subject_key_album
from .albums import create_copy, tag_genre

router = APIRouter(prefix="/bins", tags=["bins"])

# How many entry covers a bin card shows: its first four, as a 2×2.
CARD_COVERS = 4


def _visible(session: Session, slug: str, user: PressUser) -> Bin:
    b = session.exec(select(Bin).where(Bin.slug == slug)).first()
    # Only Pressd's published bins exist yet. A private bin will answer 404 to
    # anyone but its owner, so it doesn't even say it exists.
    if b is None or b.hidden_at is not None or not (
        (b.kind == "curated" and b.visibility == "published") or b.owner_id == user.id
    ):
        raise HTTPException(status_code=404, detail="Bin not found")
    return b


def _mine(session: Session, user_id: int, keys: set[str]) -> dict[str, dict]:
    if not keys:
        return {}
    rows = session.exec(
        select(Album.id, Album.subject_key, Album.status, Album.score)
        .where(Album.user_id == user_id, Album.subject_key.in_(keys))
    ).all()
    return binlib.best_copies(rows)


def _song_rows(session: Session, keys: set[str], only_user: int | None = None):
    """Every copy's songs on these albums — or one user's — for a song bin."""
    if not keys:
        return []
    q = (
        select(Album.user_id, Song.album_id, Album.subject_key, Album.status, Song.title, Song.score, Song.track_id)
        .join(Album, Album.id == Song.album_id)
        .where(Album.subject_key.in_(keys))
    )
    if only_user is not None:
        q = q.where(Album.user_id == only_user)
    return session.exec(q).all()


def _states(session: Session, user_id: int, b: Bin, entries: list[BinEntry], *, everyone: bool) -> list[dict]:
    """Each entry's `mine` (and for a song bin its Pressd figures too): an album
    bin by the caller's copies of the record, a song bin by the song on them."""
    keys = {e.subject_key for e in entries}
    if b.item_type == "song":
        rows = _song_rows(session, keys, None if everyone else user_id)
        return binlib.song_states(entries, rows, user_id)
    mine = _mine(session, user_id, keys)
    return [{"mine": mine.get(e.subject_key)} for e in entries]


def _album_predictions(session: Session, user_id: int, entries: list[BinEntry]) -> dict[int, float]:
    """entry id → the caller's predicted score for its record."""
    want = {album_key(e.artist, e.album_name) for e in entries}
    # album_key opens with the cleaned artist, so this reads only those
    # artists' rows, enough to find another edition's key among them.
    artists = {k.split("||", 1)[0] for k in want}
    rows = session.exec(
        select(AlbumPrediction.album_key, AlbumPrediction.artist, AlbumPrediction.album_name,
               AlbumPrediction.predicted_score)
        .where(AlbumPrediction.user_id == user_id,
               AlbumPrediction.predicted_score.is_not(None),
               func.split_part(AlbumPrediction.album_key, "||", 1).in_(artists))
    ).all()
    by_key = {r[0]: float(r[3]) for r in rows}
    by_subject: dict[str, float] = {}
    for _k, artist, name, score in rows:
        by_subject.setdefault(subject_key_album(artist, name), float(score))
    out = {}
    for e in entries:
        score = by_key.get(album_key(e.artist, e.album_name))
        if score is None:
            score = by_subject.get(e.subject_key)
        if score is not None:
            out[e.id] = round(score, 2)
    return out


def _card(b: Bin, entries: list[BinEntry], states: list[dict]) -> dict:
    return {
        "slug": b.slug,
        "title": b.title,
        "kind": b.kind,
        "item_type": b.item_type,
        "ranked": b.ranked,
        "source_name": b.source_name,
        "source_url": b.source_url,
        "source_year": b.source_published.year if b.source_published else None,
        "entry_count": b.entry_count,
        "covers": [e.cover_url for e in entries if e.cover_url][:CARD_COVERS],
        "progress": binlib.progress([s["mine"] for s in states]),
    }


@router.get("")
def list_bins(
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Pressd's bins, as cards: cover, title, source, and the caller's progress."""
    bins = session.exec(
        select(Bin).where(Bin.kind == "curated", Bin.visibility == "published", Bin.hidden_at.is_(None))
        .order_by(Bin.sort_order, Bin.id)
    ).all()
    if not bins:
        return []
    entries = session.exec(
        select(BinEntry).where(BinEntry.bin_id.in_([b.id for b in bins])).order_by(BinEntry.position)
    ).all()
    by_bin: dict[int, list[BinEntry]] = {}
    for e in entries:
        by_bin.setdefault(e.bin_id, []).append(e)
    cards = []
    for b in bins:
        es = by_bin.get(b.id, [])
        cards.append(_card(b, es, _states(session, user.id, b, es, everyone=False)))
    return cards


@router.get("/{slug}")
def get_bin(
    slug: str,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """A bin and its entries, each with the caller's copy (any edition), the
    Pressd average over everyone's rated copies and how many people rated it,
    and the caller's predicted score once predictions are unlocked."""
    b = _visible(session, slug, user)
    entries = session.exec(select(BinEntry).where(BinEntry.bin_id == b.id).order_by(BinEntry.position)).all()
    keys = {e.subject_key for e in entries}
    states = _states(session, user.id, b, entries, everyone=True)
    songs = b.item_type == "song"

    # The plain mean of rated copies — the community page's PRESSD AVG. A song
    # bin's comes per song, with its states.
    pressd = {}
    if keys and not songs:
        for key, avg, raters in session.exec(
            select(Album.subject_key, func.avg(Album.score), func.count(func.distinct(Album.user_id)))
            .where(Album.subject_key.in_(keys), Album.status == "rated", Album.score.is_not(None))
            .group_by(Album.subject_key)
        ).all():
            pressd[key] = (round(float(avg), 2), int(raters))

    # The record's genre: the one its copies on Pressd carry most (the tagger's,
    # where it has run), else the catalog's from the stored resolve.
    genres: dict[str, Counter] = {}
    if keys:
        for key, g in session.exec(
            select(Album.subject_key, Album.genre).where(Album.subject_key.in_(keys), Album.genre.is_not(None))
        ).all():
            genres.setdefault(key, Counter())[g] += 1

    def genre_of(e: BinEntry) -> str | None:
        tagged = genres.get(e.subject_key)
        if tagged:
            return tagged.most_common(1)[0][0]
        return canonical_genre(json.loads(e.tracklist_json).get("genre")) if e.tracklist_json else None

    # The caller's predicted score, from the nightly catalog stage, which
    # scores every bin record for every user whether or not anyone holds it
    # (worker/catalog_predict.py). An album bin's is the record's, by the
    # entry's album_key — or, when someone's copy of another edition stands for
    # the record in the catalog, that copy's, found by subject key. A song
    # bin's is the song's own, on the song scale (SongPrediction).
    predicted: dict[int, float] = {}
    if entries and predictions_unlocked(session, user.id):
        if songs:
            tids = {e.track_id for e in entries if e.track_id}
            by_track = dict(session.exec(
                select(SongPrediction.track_id, SongPrediction.predicted_score)
                .where(SongPrediction.user_id == user.id, SongPrediction.track_id.in_(tids))
            ).all()) if tids else {}
            predicted = {e.id: round(float(by_track[e.track_id]), 1)
                         for e in entries if e.track_id in by_track}
        else:
            predicted = _album_predictions(session, user.id, entries)

    return {
        **_card(b, entries, states),
        "description": b.description,
        "source_published": b.source_published.isoformat() if b.source_published else None,
        "entries": [
            {
                "genre": genre_of(e),
                "id": e.id,
                "position": e.position,
                "rank": e.rank,
                "artist": e.artist,
                "album_name": e.album_name,
                "song_title": e.song_title,
                "track_id": st.get("track_id"),
                "year": e.year,
                "cover_url": e.cover_url,
                "deezer_id": e.deezer_id,
                "addable": e.tracklist_json is not None,
                "mine": st["mine"],
                "pressd_avg": st["pressd_avg"] if songs else pressd.get(e.subject_key, (None, 0))[0],
                "pressd_raters": st["pressd_raters"] if songs else pressd.get(e.subject_key, (None, 0))[1],
                "predicted_score": predicted.get(e.id),
                "blurb": e.note,
            }
            for e, st in zip(entries, states)
        ],
    }


def _tag_later(album: Album) -> None:
    """Genre tagging for a copy a bin added, as an import queues it."""
    if not album.genre or not album.sub_genre1:
        threading.Thread(
            target=tag_genre, args=(album.id, album.artist, album.album_name, album.year), daemon=True,
        ).start()


@router.post("/{slug}/entries/{entry_id}/add")
def add_entry(
    slug: str,
    entry_id: int,
    body: dict = Body(...),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Rate now (`listening`) or Add to To Listen (`to_listen`) for one entry.
    A copy the caller already holds, in any edition, is returned instead."""
    status = body.get("status")
    if status not in ("listening", "to_listen"):
        raise HTTPException(status_code=422, detail="status must be listening or to_listen")
    b = _visible(session, slug, user)
    e = session.get(BinEntry, entry_id)
    if e is None or e.bin_id != b.id:
        raise HTTPException(status_code=404, detail="Entry not found")
    have = _mine(session, user.id, {e.subject_key}).get(e.subject_key)
    if have:
        return {"album_id": have["id"], "status": have["status"], "already_existed": True}
    if not e.tracklist_json:
        raise HTTPException(status_code=409, detail="This record isn't in the catalogs yet")
    # Linked in the request (create_copy does): Rate now opens the rating flow,
    # whose carried-over scores read the songs' track links.
    album = create_copy(session, user.id, binlib.copy_data(e, status))
    _tag_later(album)
    return {"album_id": album.id, "status": album.status, "already_existed": False}
