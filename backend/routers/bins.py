"""Bins — themed collections of records (docs/superpowers/specs/2026-11-11-bins-design.md).

Pressd's curated bins are written only by worker/import_bin.py; user bins
(docs/superpowers/specs/2026-11-13-user-bins-design.md) are made and edited
here by their owners, and their rules live in backend/user_bins.py. Every
route but a cover's bytes is behind a signed-in caller, and what it says about
the caller — progress, their copy, their predicted score — is theirs alone.
Other people appear as an average and a rater count, or, as a bin's owner,
only as public_user. A bin the caller may not see is a 404 on every route, its
owner's writes included, so a private bin can't be probed for.

A bin points at records by `subject_key`, so a copy of any edition counts.
Adding from a bin makes an ordinary copy, through the same insert as an
import (albums.create_copy), from the tracklist the import tool stored on the
entry — no outbound call — and the copy doesn't remember the bin.
"""
import base64
import json
import random
import threading
from binascii import Error as BinasciiError
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from sqlalchemy import delete, func, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from .. import bins as binlib
from .. import user_bins as ub
from ..blocks import blocked_ids
from ..database import engine, get_session
from ..deps import current_user, public_user
from ..genres import canonical_genre
from ..models import (
    Album, AlbumPrediction, Bin, BinCover, BinEntry, BinReport, BinTrack, BinView, PressUser, Song,
    SongPrediction,
)
from ..scoring import is_single_release, predictions_unlocked
from ..trackkeys import album_key, subject_key_album
from .albums import _parse_release_date, create_copy, tag_genre
from .users import AVATAR_MAX_BYTES, BANNER_JPEG_QUALITY, _normalize_image

router = APIRouter(prefix="/bins", tags=["bins"])

# How many entry covers a bin card shows: its first four, as a 2×2.
CARD_COVERS = 4


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _reported(session: Session, user_id: int) -> set[int]:
    return set(session.exec(select(BinReport.bin_id).where(BinReport.user_id == user_id)).all())


def _visible(session: Session, slug: str, user: PressUser, *, count_own_report: bool = True) -> Bin:
    """The bin, if the caller may see it (user_bins.can_view), else 404 — not
    403, so a private, hidden or blocked bin doesn't even say it exists."""
    b = session.exec(select(Bin).where(Bin.slug == slug)).first()
    reported = _reported(session, user.id) if count_own_report else set()
    if b is None or not ub.can_view(b.kind, b.owner_id, b.visibility, b.hidden_at, user.id,
                                    blocked_ids(session, user.id), reported, b.id):
        raise HTTPException(status_code=404, detail="Bin not found")
    return b


def _owned(session: Session, slug: str, user: PressUser) -> Bin:
    """The caller's own bin for a write. Anyone else's — public or not, Pressd's
    included — is the same 404 as a bin that doesn't exist."""
    b = session.exec(select(Bin).where(Bin.slug == slug)).first()
    if b is None or b.kind != "user" or b.owner_id is None or b.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Bin not found")
    return b


def _entries(session: Session, bin_id: int) -> list[BinEntry]:
    return list(session.exec(select(BinEntry).where(BinEntry.bin_id == bin_id).order_by(BinEntry.position)).all())


def _touch(session: Session, b: Bin) -> None:
    b.updated_at = _now()
    session.add(b)


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


def _card(b: Bin, entries: list[BinEntry], states: list[dict], viewer_id: int,
          owner: PressUser | None = None) -> dict:
    """A bin as a card. `owner` is the user row behind `b.owner_id` (None for
    Pressd's bins and for a public bin whose owner deleted their account, which
    reads as "a former Pressd member")."""
    mine = b.kind == "user" and b.owner_id is not None and b.owner_id == viewer_id
    return {
        "slug": b.slug,
        "title": b.title,
        "kind": b.kind,
        "item_type": b.item_type,
        "ranked": b.ranked,
        "visibility": b.visibility,
        "owner": public_user(owner) if owner is not None and b.owner_id is not None else None,
        "can_edit": mine,
        "cover_url": b.cover_url,
        "source_name": b.source_name,
        "source_url": b.source_url,
        "source_year": b.source_published.year if b.source_published else None,
        "entry_count": b.entry_count,
        "covers": [e.cover_url for e in entries if e.cover_url][:CARD_COVERS],
        "progress": binlib.progress([s["mine"] for s in states]),
    }


def _cards(session: Session, user: PressUser, bins: list[Bin]) -> list[dict]:
    """Cards for these bins, in this order: one read for their entries, one for
    their owners, and one for the caller's copies across every album bin."""
    if not bins:
        return []
    by_bin: dict[int, list[BinEntry]] = {}
    for e in session.exec(
        select(BinEntry).where(BinEntry.bin_id.in_([b.id for b in bins])).order_by(BinEntry.position)
    ).all():
        by_bin.setdefault(e.bin_id, []).append(e)
    owner_ids = {b.owner_id for b in bins if b.owner_id is not None}
    owners = {u.id: u for u in session.exec(select(PressUser).where(PressUser.id.in_(owner_ids))).all()} \
        if owner_ids else {}
    album_keys = {e.subject_key for b in bins if b.item_type != "song" for e in by_bin.get(b.id, [])}
    mine = _mine(session, user.id, album_keys)
    cards = []
    for b in bins:
        es = by_bin.get(b.id, [])
        if b.item_type == "song":
            states = _states(session, user.id, b, es, everyone=False)
        else:
            states = [{"mine": mine.get(e.subject_key)} for e in es]
        cards.append(_card(b, es, states, user.id, owners.get(b.owner_id)))
    return cards


def _curated(session: Session) -> list[Bin]:
    return list(session.exec(
        select(Bin).where(Bin.kind == "curated", Bin.visibility == "published", Bin.hidden_at.is_(None))
        .order_by(Bin.sort_order, Bin.id)
    ).all())


def _community(session: Session, user: PressUser) -> list[Bin]:
    """Published user bins the caller may see, most popular first (spec §8):
    distinct people who opened one in the last POPULAR_DAYS, its owner not
    counted, then newest. The caller's own are left out — they have their own
    section — and so is anything can_view refuses."""
    blocked, reported = blocked_ids(session, user.id), _reported(session, user.id)
    bins = [b for b in session.exec(
        select(Bin).where(Bin.kind == "user", Bin.visibility == "published", Bin.hidden_at.is_(None),
                          or_(Bin.owner_id.is_(None), Bin.owner_id != user.id))
    ).all() if ub.can_view(b.kind, b.owner_id, b.visibility, b.hidden_at, user.id, blocked, reported, b.id)]
    if not bins:
        return []
    since = _now() - timedelta(days=ub.POPULAR_DAYS)
    viewers = dict(session.exec(
        select(BinView.bin_id, func.count())
        .join(Bin, Bin.id == BinView.bin_id)
        .where(BinView.bin_id.in_([b.id for b in bins]), BinView.viewed_at >= since,
               or_(Bin.owner_id.is_(None), BinView.user_id != Bin.owner_id))
        .group_by(BinView.bin_id)
    ).all())
    by_id = {b.id: b for b in bins}
    order = ub.community_order([(b.id, int(viewers.get(b.id, 0)), b.updated_at or b.created_at) for b in bins])
    return [by_id[i] for i in order]


@router.get("")
def list_bins(
    scope: str = Query("curated", pattern="^(curated|mine|community|for_you)$"),
    owner: int | None = Query(None),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Bins as cards — cover, title, source or owner, and the caller's progress.
    `curated`: Pressd's. `mine`: the caller's own, any visibility, last edited
    first. `community`: other people's published bins, most popular first.
    `for_you`: For You's row — Pressd's first bin, then community bins at
    random (re-drawn on every load), Pressd's next filling any gap.

    `owner` (overrides `scope`): one person's bins, for the Bins tab on their
    profile — your own, any visibility, as `mine`; anyone else's only as
    `can_view` lets you see them (published, unhidden, not blocked or reported
    by you), last edited first."""
    if owner is not None and owner != user.id:
        blocked, reported = blocked_ids(session, user.id), _reported(session, user.id)
        bins = [b for b in session.exec(
            select(Bin).where(Bin.kind == "user", Bin.owner_id == owner, Bin.visibility == "published",
                              Bin.hidden_at.is_(None))
            .order_by(Bin.updated_at.desc(), Bin.id.desc())
        ).all() if ub.can_view(b.kind, b.owner_id, b.visibility, b.hidden_at, user.id, blocked, reported, b.id)]
        return _cards(session, user, bins)
    if owner is not None or scope == "mine":
        bins = list(session.exec(
            select(Bin).where(Bin.kind == "user", Bin.owner_id == user.id).order_by(Bin.updated_at.desc(), Bin.id.desc())
        ).all())
    elif scope == "community":
        bins = _community(session, user)
    elif scope == "for_you":
        curated = _curated(session)
        community = _community(session, user)
        by_id = {b.id: b for b in curated + community}
        picked = ub.for_you_pick([b.id for b in curated], [b.id for b in community], random.Random())
        bins = [by_id[i] for i in picked]
    else:
        bins = _curated(session)
    return _cards(session, user, bins)


@router.post("")
def create_bin(
    body: dict = Body(...),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """A new bin, private until its owner publishes it (spec §3)."""
    fields = _bin_fields(body, partial=False)
    held = session.exec(select(func.count()).select_from(Bin).where(Bin.kind == "user", Bin.owner_id == user.id)).one()
    if held >= ub.MAX_BINS_PER_USER:
        raise HTTPException(status_code=409, detail=f"You can have up to {ub.MAX_BINS_PER_USER} bins")
    slug = ub.new_slug()
    while session.exec(select(Bin.id).where(Bin.slug == slug)).first() is not None:
        slug = ub.new_slug()
    b = Bin(slug=slug, kind="user", owner_id=user.id, item_type="album", sort_order=0, entry_count=0,
            title=fields["title"], description=fields.get("description"),
            ranked=fields.get("ranked", True), visibility=fields.get("visibility", "private"))
    session.add(b)
    session.commit()
    session.refresh(b)
    return _card(b, [], [], user.id, user)


def _bin_fields(body: dict, *, partial: bool) -> dict:
    """The writable fields present in a create or edit body, checked. A field
    left out of an edit is left alone; `description` sent empty clears it."""
    out: dict = {}
    try:
        if "title" in body or not partial:
            out["title"] = ub.clean_text(body.get("title"), ub.TITLE_MAX, required=True)
        if "description" in body:
            out["description"] = ub.clean_text(body.get("description"), ub.DESCRIPTION_MAX, required=False)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if "ranked" in body:
        if not isinstance(body["ranked"], bool):
            raise HTTPException(status_code=422, detail="ranked must be true or false")
        out["ranked"] = body["ranked"]
    if "visibility" in body:
        if body["visibility"] not in ub.VISIBILITIES:
            raise HTTPException(status_code=422, detail="visibility must be private or published")
        out["visibility"] = body["visibility"]
    return out


@router.patch("/{slug}")
def update_bin(
    slug: str,
    body: dict = Body(...),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    b = _owned(session, slug, user)
    fields = _bin_fields(body, partial=True)
    for k, v in fields.items():
        setattr(b, k, v)
    entries = _entries(session, b.id)
    if "ranked" in fields:
        # The list's order is the rank; an unranked list has none to print.
        for e in entries:
            e.rank = e.position + 1 if b.ranked else None
            session.add(e)
    _touch(session, b)
    session.commit()
    session.refresh(b)
    return _cards(session, user, [b])[0]


def _drop_entries(session: Session, entry_ids: list[int]) -> None:
    """bintrack rows first: they hold a foreign key to the entry."""
    if entry_ids:
        session.execute(delete(BinTrack).where(BinTrack.entry_id.in_(entry_ids)))
        session.execute(delete(BinEntry).where(BinEntry.id.in_(entry_ids)))


@router.delete("/{slug}")
def delete_bin(
    slug: str,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    b = _owned(session, slug, user)
    _drop_entries(session, [e.id for e in _entries(session, b.id)])
    for model in (BinCover, BinReport, BinView):
        session.execute(delete(model).where(model.bin_id == b.id))
    session.delete(b)
    session.commit()
    return {"ok": True}


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
    if b.kind == "user" and b.owner_id != user.id:
        # One row per person, its time refreshed: what orders From the
        # community (spec §8). Pressd's bins aren't ordered by it, so they
        # aren't written to.
        session.execute(pg_insert(BinView).values(bin_id=b.id, user_id=user.id, viewed_at=_now())
                     .on_conflict_do_update(index_elements=["bin_id", "user_id"],
                                            set_={"viewed_at": _now()}))
        session.commit()
    entries = _entries(session, b.id)
    owner = session.get(PressUser, b.owner_id) if b.owner_id is not None else None
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
        **_card(b, entries, states, user.id, owner),
        "description": b.description,
        "source_published": b.source_published.isoformat() if b.source_published else None,
        "entries": [
            {
                **_entry_row(b, e),
                "genre": genre_of(e),
                "track_id": st.get("track_id"),
                "mine": st["mine"],
                "pressd_avg": st["pressd_avg"] if songs else pressd.get(e.subject_key, (None, 0))[0],
                "pressd_raters": st["pressd_raters"] if songs else pressd.get(e.subject_key, (None, 0))[1],
                "predicted_score": predicted.get(e.id),
            }
            for e, st in zip(entries, states)
        ],
    }


def _entry_row(b: Bin, e: BinEntry) -> dict:
    """An entry's own fields. `note` is the same column read two ways: on
    Pressd's bins it's Pressd's blurb, on a user's bin the owner's note, and
    the payload carries both keys with the other null so neither is mistaken
    for the other."""
    curated = b.kind == "curated"
    return {
        "id": e.id,
        "position": e.position,
        "rank": e.rank,
        "artist": e.artist,
        "album_name": e.album_name,
        "song_title": e.song_title,
        "year": e.year,
        "cover_url": e.cover_url,
        "deezer_id": e.deezer_id,
        "addable": e.tracklist_json is not None,
        "blurb": e.note if curated else None,
        "note": None if curated else e.note,
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


# ── An owner's entries ────────────────────────────────────────────────────────

def release_refusal(release: dict, today: date) -> str | None:
    """Why a resolved release can't go in a bin (user_bins.addable_release),
    with the library's own single test (scoring.is_single_release) on top —
    an iTunes "- Single" counts even where its track count doesn't say so. A
    catalog that gives only a year still says "not out" when the year is ahead."""
    tracks = release.get("tracks") or []
    released = _parse_release_date(release.get("release_date"))
    year = release.get("year")
    if released is None and isinstance(year, int) and year > today.year:
        return "unreleased"
    reason = ub.addable_release(released, len(tracks), release.get("album_name") or "", today)
    if reason is None and is_single_release(release.get("album_name"), len(tracks)):
        reason = "single"
    return reason


# More songs than any record a bin should hold; a longer list is refused.
MAX_RELEASE_TRACKS = 200


# Postgres INTEGER: track numbers, durations and Deezer ids land in int4
# columns (bintrack, binentry, album, song), and one value past it fails the
# whole insert it rides in.
INT4_MAX = 2_147_483_647


def _int_or_none(v, what: str, lo: int = 0, hi: int = INT4_MAX) -> int | None:
    """A whole number in [lo, hi], or None when absent. Anything else — a
    string that isn't a number, a list, NaN, Infinity, a value out of range —
    is a ValueError, which the route answers with a 422."""
    if v is None or v == "":
        return None
    if isinstance(v, (dict, list)):
        raise ValueError(f"{what} must be a number")
    try:
        n = int(v)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(f"{what} must be a number")
    if not lo <= n <= hi:
        raise ValueError(f"{what} is out of range")
    return n


def _str_or_none(v) -> str | None:
    return str(v) if isinstance(v, (str, int, float)) and str(v).strip() else None


def clean_release(release: dict) -> dict:
    """A client-sent release rebuilt from the fields /search/resolve has and
    nothing else. It is stored as the entry's tracklist, and the nightly audio
    ingest links every unlinked entry in one pass (tracklink.link_bin_entries,
    which writes track numbers and durations into integer columns): one
    malformed song there would fail that run, and every run after it, for
    everyone. So every value is checked here, once, and a bad one is a 422."""
    if not isinstance(release, dict):
        raise ValueError("a release must be an object")
    artist = str(release.get("artist") or "").strip()
    name = str(release.get("album_name") or "").strip()
    raw_tracks = release.get("tracks")
    if not artist or not name or not isinstance(raw_tracks, list):
        raise ValueError("a release needs an artist, a title and its tracks")
    if len(raw_tracks) > MAX_RELEASE_TRACKS:
        raise ValueError(f"a release has at most {MAX_RELEASE_TRACKS} tracks")
    tracks = []
    for t in raw_tracks:
        if not isinstance(t, dict) or not isinstance(t.get("title"), str) or not t["title"].strip():
            raise ValueError("every track needs a title")
        tracks.append({
            "title": t["title"].strip(),
            "track_number": _int_or_none(t.get("track_number"), "track_number"),
            "duration_ms": _int_or_none(t.get("duration_ms"), "duration_ms"),
            "explicit": bool(t.get("explicit")),
            "spotify_id": None,
            "artist": _str_or_none(t.get("artist")) or artist,
        })
    extra = release.get("extra_artists")
    extra = [str(a) for a in extra if isinstance(a, str) and a.strip()] if isinstance(extra, list) else []
    return {
        "spotify_id": None,
        "album_name": name,
        "artist": artist,
        "extra_artists": extra,
        "year": _int_or_none(release.get("year"), "year", 1000, 3000),
        "release_date": _str_or_none(release.get("release_date")),
        "cover_url": _str_or_none(release.get("cover_url") or release.get("art_url")),
        "total_tracks": _int_or_none(release.get("total_tracks"), "total_tracks", 0, 10_000),
        "genre": _str_or_none(release.get("genre")),
        "deezer_id": _int_or_none(release.get("deezer_id"), "deezer_id", 1),
        "tracks": tracks,
    }


def entry_fields(r: dict) -> dict:
    """A BinEntry's columns from a release clean_release has already checked
    (/search/resolve's shape, as import_bin stores a curated entry's), kept
    whole as the tracklist so the bin's Add makes the copy from it with no
    outbound call."""
    return {
        "artist": r["artist"],
        "album_name": r["album_name"],
        "year": r["year"],
        "subject_key": subject_key_album(r["artist"], r["album_name"]),
        "deezer_id": r["deezer_id"],
        "cover_url": r["cover_url"],
        "tracklist_json": json.dumps(r),
    }


def release_from_copy(album, songs) -> dict:
    """One of the caller's copies as a resolved release, so an entry added from
    the library is stored exactly like one added from the catalog."""
    try:
        extra = json.loads(album.extra_artists) if album.extra_artists else []
    except ValueError:
        extra = []
    ordered = sorted(songs, key=lambda s: (s.track_number is None, s.track_number or 0))
    return {
        "spotify_id": None,
        "album_name": album.album_name,
        "artist": album.artist,
        "extra_artists": extra,
        "year": album.year,
        "release_date": album.release_date.isoformat() if album.release_date else None,
        "cover_url": album.album_art_url,
        "total_tracks": album.total_tracks or len(ordered),
        "genre": album.genre,
        "tracks": [
            {"title": s.title, "track_number": s.track_number, "duration_ms": s.duration_ms,
             "explicit": bool(s.explicit), "spotify_id": None, "artist": s.artist or album.artist}
            for s in ordered
        ],
    }


def checked_order(current_ids: list[int], requested) -> list[int]:
    """A reorder names every entry once (user_bins.validate_order); anything
    else is a list made before an add or a remove elsewhere, refused whole."""
    try:
        return ub.validate_order(current_ids, list(requested))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _write_order(session: Session, b: Bin, ordered: list[BinEntry]) -> None:
    """Positions are unique per bin, so every row first steps aside to a
    negative position, then takes its final one — one transaction, the
    caller's commit. The list's order is the rank when the bin is ranked."""
    for i, e in enumerate(ordered):
        e.position = -(i + 1)
        session.add(e)
    session.flush()
    for i, e in enumerate(ordered):
        e.position = i
        e.rank = i + 1 if b.ranked else None
        session.add(e)
    b.entry_count = len(ordered)
    _touch(session, b)


def _link_entry(entry_id: int) -> None:
    """The new entry's songs onto Tracks (tracklink.link_bin_entries), so the
    audio ingest and the prediction catalog reach the record. Its own
    connection, after the entry is committed: link_bin_entries commits as it
    goes, which a session's connection can't survive. A failure leaves the
    entry unlinked for the nightly ingest's backstop pass to finish."""
    from ..tracklink import link_bin_entries
    try:
        with engine.connect() as con:
            link_bin_entries(con, entry_ids=[entry_id])
    except Exception as exc:  # noqa: BLE001 — the add itself already succeeded
        print(f"[bins] linking entry {entry_id} failed: {exc}")


@router.post("/{slug}/entries")
def add_to_bin(
    slug: str,
    body: dict = Body(...),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Put a record in the caller's bin: `album_id`, one of their own copies,
    or `release`, a record resolved from the catalogs (/search/resolve). An
    unreleased record or a single is refused (400), as is a record already in
    the bin in any edition, or a full bin (409)."""
    b = _owned(session, slug, user)
    if body.get("album_id") is not None:
        album = session.get(Album, body.get("album_id"))
        if album is None or album.user_id != user.id:
            raise HTTPException(status_code=404, detail="Album not found")
        songs = session.exec(select(Song).where(Song.album_id == album.id)).all()
        release = release_from_copy(album, songs)
    elif isinstance(body.get("release"), dict):
        release = body["release"]
    else:
        raise HTTPException(status_code=422, detail="Send album_id or release")
    try:
        release = clean_release(release)
        fields = entry_fields(release)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    reason = release_refusal(release, date.today())
    if reason:
        raise HTTPException(status_code=400, detail=reason)

    entries = _entries(session, b.id)
    if len(entries) >= ub.MAX_ENTRIES:
        raise HTTPException(status_code=409, detail=f"A bin holds up to {ub.MAX_ENTRIES} albums")
    if any(e.subject_key == fields["subject_key"] for e in entries):
        raise HTTPException(status_code=409, detail="That album is already in this bin")
    pos = len(entries)
    e = BinEntry(bin_id=b.id, position=pos, rank=pos + 1 if b.ranked else None,
                 match_status="matched", **fields)
    session.add(e)
    b.entry_count = pos + 1
    _touch(session, b)
    try:
        session.commit()
    except IntegrityError:
        # Another add took this position first.
        session.rollback()
        raise HTTPException(status_code=409, detail="The bin changed; try again")
    session.refresh(e)
    session.refresh(b)
    _link_entry(e.id)
    mine = _mine(session, user.id, {e.subject_key}).get(e.subject_key)
    return {**_entry_row(b, e), "mine": mine}


def _owned_entry(session: Session, b: Bin, entry_id: int) -> BinEntry:
    e = session.get(BinEntry, entry_id)
    if e is None or e.bin_id != b.id:
        raise HTTPException(status_code=404, detail="Entry not found")
    return e


@router.patch("/{slug}/entries/{entry_id}")
def update_entry(
    slug: str,
    entry_id: int,
    body: dict = Body(...),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """The owner's note on one record; empty clears it."""
    b = _owned(session, slug, user)
    e = _owned_entry(session, b, entry_id)
    try:
        e.note = ub.clean_text(body.get("note"), ub.NOTE_MAX, required=False)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    session.add(e)
    _touch(session, b)
    session.commit()
    session.refresh(e)
    return _entry_row(b, e)


@router.delete("/{slug}/entries/{entry_id}")
def remove_entry(
    slug: str,
    entry_id: int,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Take a record out; the rest close up, so positions stay 0..n-1."""
    b = _owned(session, slug, user)
    gone = _owned_entry(session, b, entry_id)
    _drop_entries(session, [gone.id])
    session.flush()
    _write_order(session, b, [e for e in _entries(session, b.id) if e.id != gone.id])
    session.commit()
    return {"ok": True, "entry_count": b.entry_count}


@router.put("/{slug}/order")
def reorder_bin(
    slug: str,
    body: dict = Body(...),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """The whole new order, as `entry_ids`."""
    b = _owned(session, slug, user)
    entries = _entries(session, b.id)
    order = checked_order([e.id for e in entries], body.get("entry_ids") or [])
    by_id = {e.id: e for e in entries}
    _write_order(session, b, [by_id[i] for i in order])
    session.commit()
    return {"ok": True, "entry_ids": order}


# ── A bin's own picture ───────────────────────────────────────────────────────

@router.post("/{slug}/cover")
def upload_cover(
    slug: str,
    request: Request,
    data: dict = Body(...),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Store the owner's picture for a bin and point cover_url at it: the same
    body (base64 `data`), guards and cache-buster as a profile banner, so both
    apps upload it the way they already upload a banner. Stored square."""
    b = _owned(session, slug, user)
    try:
        raw = base64.b64decode(data.get("data") or "", validate=True)
    except (BinasciiError, ValueError):
        raise HTTPException(status_code=400, detail="Image data is not valid base64")
    if not raw:
        raise HTTPException(status_code=400, detail="Image is empty")
    if len(raw) > AVATAR_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large — resize it first")
    stored = _normalize_image(raw, ub.BIN_COVER_SIZE, BANNER_JPEG_QUALITY)

    row = session.get(BinCover, b.id)
    if row:
        row.content_type, row.data, row.updated_at = "image/jpeg", stored, _now()
    else:
        row = BinCover(bin_id=b.id, content_type="image/jpeg", data=stored, updated_at=_now())
    session.add(row)
    stamp = int(row.updated_at.timestamp())
    b.cover_url = f"{str(request.base_url).rstrip('/')}/bins/{b.slug}/cover?v={stamp}"
    _touch(session, b)
    session.commit()
    return {"cover_url": b.cover_url, "bytes": len(stored), "received_bytes": len(raw)}


@router.get("/{slug}/cover")
def get_cover(slug: str, session: Session = Depends(get_session)):
    """Unauthenticated, as avatars and banners are: an <Image> source carries no
    bearer token. It checks nothing more — the address, random slug and `?v=`
    stamp, is only ever handed to people who may see the bin."""
    row = session.exec(
        select(BinCover).join(Bin, Bin.id == BinCover.bin_id).where(Bin.slug == slug)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="No cover")
    return Response(content=row.data, media_type=row.content_type,
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.delete("/{slug}/cover")
def delete_cover(
    slug: str,
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Back to the mosaic of the first four covers."""
    b = _owned(session, slug, user)
    session.execute(delete(BinCover).where(BinCover.bin_id == b.id))
    b.cover_url = None
    _touch(session, b)
    session.commit()
    return {"ok": True}


# ── Reports ───────────────────────────────────────────────────────────────────

@router.post("/{slug}/report")
def report_bin(
    slug: str,
    body: dict = Body(default={}),
    user: PressUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Report someone's bin. It leaves the reporter's lists at once (can_view);
    REPORTS_TO_HIDE different people hide it from everyone and from what
    counts. Reporting again only updates the reason, so it still answers for a
    bin the caller has already reported."""
    b = _visible(session, slug, user, count_own_report=False)
    if b.kind != "user":
        raise HTTPException(status_code=400, detail="Pressd's bins can't be reported")
    if b.owner_id == user.id:
        raise HTTPException(status_code=400, detail="You can't report your own bin")
    try:
        reason = ub.clean_text((body or {}).get("reason"), ub.DESCRIPTION_MAX, required=False)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    session.execute(pg_insert(BinReport).values(user_id=user.id, bin_id=b.id, reason=reason, created_at=_now())
                 .on_conflict_do_update(index_elements=["user_id", "bin_id"], set_={"reason": reason}))
    reporters = session.exec(
        select(func.count(func.distinct(BinReport.user_id))).where(BinReport.bin_id == b.id)
    ).one()
    if reporters >= ub.REPORTS_TO_HIDE and b.hidden_at is None:
        b.hidden_at = _now()
        session.add(b)
    session.commit()
    return {"ok": True}
