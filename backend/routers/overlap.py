"""Taste overlap on the surfaces: the number on a profile, and the people sheet owed
after a first rating (spec §5).

**The profile number** (`GET /users/{id}/overlap`) is the stored pair, or 50 with no
reason when there is no row: a missing row is 50 (spec §8), and a no-evidence 50 looks
exactly like a measured one. Profiles are public, so any signed-in user may ask about
anyone. Yourself is null.

**The sheet.** `PATCH /albums/{id}` owes one on a copy's first rating
(`albums._owes_sheet`). The client asks for it as the share card closes and on launch;
`GET /overlap/sheet` serves the newest owed sheet less than `SHEET_TTL` old and
supersedes every other owed one — the only write it makes to sheets, so asking twice,
or from two devices, serves the same sheet. It never marks a sheet shown: the client
posts `shown` to the events endpoint once the sheet is on screen, and that clears it.
`not_now` clears it too, for a client that never got as far as reporting `shown`.

Who is on it: other users with a rated copy of the record (`subject_key`, any edition),
never yourself, a friend, or anyone with a request pending either way.
`taste_overlap.pick_people` chooses two close and one far. Each row carries the
person's favourite and least favourite song from their copy of the record. With nobody
like that there is no sheet: it is superseded, so it can't turn up hours later once
someone does rate the record. Until November 2026 it fell back to every user with a
rated album ("People who like what you like", songs from their nearest record), which
put strangers who'd never heard the album under it; the record is the point.

Before the sheet's numbers are read, a caller who rated since their stored vector
recomputes against the record's raters (`taste_live.refresh`), so the people who just
became comparable aren't shown at last night's 50. A recompute
that fails is rolled back and logged, and the request serves the stored numbers
(`_refresh`): last night's percent is a worse answer than a fresh one, not a reason to
fail the profile or the sheet.

The reason's `text` has every name HTML-escaped; clients render from the structured
fields, or tokenise the literal `<i>…</i>`, never inject `text` as HTML.
"""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, update
from sqlmodel import Session, select

from ..database import get_session
from ..blocks import blocked_ids
from ..deps import authorize_view, current_user, public_user
from ..models import Album, Friendship, OverlapEvent, OverlapSheet, PressUser, Song, TasteOverlap
from ..scoring import top_bottom_songs
from ..taste_live import refresh as refresh_live
from ..taste_overlap import pick_people

router = APIRouter(tags=["overlap"])

SHEET_TTL = timedelta(hours=48)
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


# ---------------------------------------------------------------- pure helpers

def _utc(t: datetime | None) -> datetime | None:
    return t.replace(tzinfo=timezone.utc) if t is not None and t.tzinfo is None else t


def _eligible(candidates: list[int], friends_or_pending: set[int], me: int) -> list[int]:
    """Candidates in order, without yourself, friends, pending requests or repeats."""
    seen: set[int] = set()
    out: list[int] = []
    for uid in candidates:
        if uid != me and uid not in friends_or_pending and uid not in seen:
            seen.add(uid)
            out.append(uid)
    return out


def _choose_sheet(owed: list, now: datetime) -> tuple[object | None, list[int]]:
    """(the sheet to serve, ids to supersede): the newest owed sheet if it is under
    SHEET_TTL old, and every other owed sheet, expired or older, superseded."""
    ranked = sorted(owed, key=lambda s: (_utc(s.created_at) or EPOCH, s.id), reverse=True)
    if ranked and now - (_utc(ranked[0].created_at) or EPOCH) <= SHEET_TTL:
        return ranked[0], [s.id for s in ranked[1:]]
    return None, [s.id for s in ranked]


def _recent_first(albums: list) -> list:
    return sorted(albums, key=lambda a: (_utc(a.rated_at) or EPOCH, a.date_rated or datetime.min.date(), a.id),
                  reverse=True)


def _apply_event(sheet, action: str, now: datetime) -> bool:
    """Apply a sheet event; returns whether to log it. `shown` and `not_now` clear the
    sheet the first time, and `shown` is logged only then, so a sheet on two devices
    counts as shown once."""
    first = sheet.shown_at is None
    if action in ("shown", "not_now") and first:
        sheet.status = "shown"
        sheet.shown_at = now
    return first if action == "shown" else True


SHARED_SHOWN = 3   # covers in the profile's overlap pill; the rest are a count


def _album_brief(album) -> dict | None:
    if album is None:
        return None
    return {"id": album.id, "name": album.album_name, "artist": album.artist, "art_url": album.album_art_url}


def _song(s) -> dict | None:
    return {"title": s.title, "score": s.score} if s else None


# ---------------------------------------------------------------- the two reads

def _refresh(store, me: int, others: set[int], mark_fresh: bool = True) -> None:
    """The live recompute, or the stored numbers when it fails: the session is rolled
    back, so the reads that follow run in a usable transaction."""
    try:
        store.refresh(me, others, mark_fresh)
    except Exception as e:
        store.rollback()
        print(f"[taste_live] refresh failed for user {me}, serving stored numbers: {e}")


def serve_sheet(store, me: int, now: datetime, rng: random.Random) -> dict | None:
    sheet, stale = _choose_sheet(store.owed_sheets(me), now)
    album = store.album(sheet.album_id) if sheet else None
    if sheet is not None and (album is None or album.user_id != me or album.status != "rated"):
        stale.append(sheet.id)          # deleted, or no longer a rating: nothing to show
        sheet = None
    out = build_sheet(store, me, sheet, album, rng) if sheet else None
    if sheet is not None and out is None:
        stale.append(sheet.id)          # nobody else to show: done, not owed
    if stale:
        store.supersede(stale)
    return out


def build_sheet(store, me: int, sheet, album, rng: random.Random) -> dict | None:
    # Never a friend, a pending request, or anyone blocked either way.
    excluded = set(store.friends_or_pending(me)) | store.blocked(me)
    raters = store.record_raters(album.subject_key, me) if album.subject_key else {}
    people = _eligible(sorted(raters), excluded, me)
    if not people:
        return None
    _refresh(store, me, set(raters))
    percents = store.stored_percents(me, people)
    picked = pick_people([(u, percents.get(u, 50.0)) for u in people], rng)
    users = store.users(picked)
    rows = []
    for uid in picked:
        if uid not in users:
            continue
        copy = raters[uid]
        top, bottom = top_bottom_songs(copy, store.album_songs(copy.id))
        rows.append({
            "user": public_user(users[uid]),
            "percent": round(percents.get(uid, 50.0)),
            "top_song": _song(top),
            "bottom_song": _song(bottom),
            "from_album": None,         # app builds from before Nov 2026 read it
        })
    if not rows:
        return None
    # Everyone else who rated the record, friends and pending included: they rated
    # it too, and the heading counts them, not the three it shows. `fallback` is
    # always false now; app builds from before November 2026 still read it.
    return {"sheet_id": sheet.id, "album": _album_brief(album), "fallback": False,
            "raters": len(raters), "people": rows}


def profile_overlap(store, me: int, other: int) -> dict:
    if other == me:
        return {"percent": None, "reason": None, "connecting_album_id": None, "connecting_album": None,
                "shared_records": [], "shared_count": 0}
    _refresh(store, me, {other}, mark_fresh=False)
    percent, reason = store.overlap_row(me, other) or (50.0, None)
    copy = None
    if reason and reason.get("subject_key"):
        copy = store.their_copy(other, reason["subject_key"])
        reason = {**reason, "album_id": copy.id if copy else None}
    shared = store.shared_records(me, other)
    if copy is None:
        copy = shared[0] if shared else None
    # The profile's pill draws the first few covers and counts the rest: the
    # records you have both rated, as their copies, newest first.
    return {"percent": round(percent), "reason": reason,
            "connecting_album_id": copy.id if copy else None, "connecting_album": _album_brief(copy),
            "shared_records": [_album_brief(a) for a in shared[:SHARED_SHOWN]], "shared_count": len(shared)}


def friends_overlap(store, me: int, owner: int) -> list[dict]:
    """A profile's friends list, each friend with the *viewer's* taste overlap
    with them — on your own profile, yours with each friend; on someone else's,
    yours with each of theirs. You, when you're in their list, come first with no
    percent; the rest by percent, highest first, then name.

    The pairs go through the same live refresh as the profile's own pill
    (`_refresh`, not marking the viewer fresh: a friends list is a subset of the
    userbase, as one profile is), so a viewer who rated since last night reads
    the list and the pills on the same numbers.

    Each row also says where the viewer stands with that friend
    (`relationship`: self / friends / sent / received / none), so someone
    else's list can offer Add, Requested or Accept beside each person."""
    hidden = store.blocked(me)
    ids = [u for u in store.friend_ids(owner) if u not in hidden]
    others = [u for u in ids if u != me]
    if others:
        _refresh(store, me, set(others), mark_fresh=False)
    percents = store.stored_percents(me, others)
    people = store.users(ids)
    rel = store.relationships(me) if others else {}
    rows = [{"user": public_user(people[u]),
             "percent": None if u == me else round(percents.get(u, 50.0)),
             "relationship": "self" if u == me else rel.get(u, "none")}
            for u in ids if u in people]
    rows.sort(key=lambda r: (r["percent"] is not None, -(r["percent"] or 0), r["user"]["name"].lower()))
    return rows


# ---------------------------------------------------------------- data access

class Store:
    """The reads and writes `serve_sheet` and `profile_overlap` need, over the
    request's session. ORM objects stay usable across the commits the live path makes,
    each of which returns the connection to SQLAlchemy's pool for the process's other
    requests (`expire_on_commit` off): nothing here edits them."""

    def __init__(self, session: Session):
        self.session = session
        session.expire_on_commit = False

    def owed_sheets(self, me: int) -> list[OverlapSheet]:
        return list(self.session.exec(
            select(OverlapSheet).where(OverlapSheet.user_id == me, OverlapSheet.status == "owed")).all())

    def supersede(self, ids: list[int]) -> None:
        self.session.execute(update(OverlapSheet).where(OverlapSheet.id.in_(ids), OverlapSheet.status == "owed")
                          .values(status="superseded"))
        self.session.commit()

    def album(self, album_id: int) -> Album | None:
        return self.session.get(Album, album_id)

    def blocked(self, me: int) -> set[int]:
        """Everyone blocked either way with `me` (backend/blocks.py)."""
        return blocked_ids(self.session, me)

    def friends_or_pending(self, me: int) -> set[int]:
        rows = self.session.exec(select(Friendship.user_id_a, Friendship.user_id_b).where(
            or_(Friendship.user_id_a == me, Friendship.user_id_b == me))).all()
        return {b if a == me else a for a, b in rows}

    def relationships(self, me: int) -> dict[int, str]:
        """Where `me` stands with everyone they share a friendship row with:
        friends, sent (asked by me) or received (asked of me)."""
        rows = self.session.exec(select(Friendship).where(
            or_(Friendship.user_id_a == me, Friendship.user_id_b == me))).all()
        return {(f.user_id_b if f.user_id_a == me else f.user_id_a):
                ("friends" if f.status == "accepted" else "sent" if f.requested_by == me else "received")
                for f in rows}

    def friend_ids(self, uid: int) -> list[int]:
        """Accepted friendships only: a pending request isn't a friend."""
        rows = self.session.exec(select(Friendship.user_id_a, Friendship.user_id_b).where(
            or_(Friendship.user_id_a == uid, Friendship.user_id_b == uid),
            Friendship.status == "accepted")).all()
        return [b if a == uid else a for a, b in rows]

    def record_raters(self, subject_key: str, me: int) -> dict[int, Album]:
        """Each other user's most recent rated copy of the record."""
        copies = self.session.exec(select(Album).where(
            Album.subject_key == subject_key, Album.status == "rated", Album.user_id != me)).all()
        out: dict[int, Album] = {}
        for a in _recent_first(list(copies)):
            out.setdefault(a.user_id, a)
        return out

    def rated_albums(self, uid: int) -> list[Album]:
        return list(self.session.exec(select(Album).where(Album.user_id == uid, Album.status == "rated")).all())

    def refresh(self, me: int, others: set[int], mark_fresh: bool = True) -> None:
        refresh_live(self.session, me, others, mark_fresh)

    def rollback(self) -> None:
        self.session.rollback()

    def stored_percents(self, me: int, uids: list[int]) -> dict[int, float]:
        rows = self.session.exec(select(TasteOverlap).where(or_(
            (TasteOverlap.user_id_a == me) & TasteOverlap.user_id_b.in_(uids),
            (TasteOverlap.user_id_b == me) & TasteOverlap.user_id_a.in_(uids)))).all()
        return {(r.user_id_b if r.user_id_a == me else r.user_id_a): r.percent for r in rows}

    def album_songs(self, album_id: int) -> list[Song]:
        return list(self.session.exec(select(Song).where(Song.album_id == album_id)).all())

    def users(self, uids: list[int]) -> dict[int, PressUser]:
        return {u.id: u for u in self.session.exec(select(PressUser).where(PressUser.id.in_(uids))).all()}

    def overlap_row(self, me: int, other: int) -> tuple[float, dict | None] | None:
        row = self.session.get(TasteOverlap, (min(me, other), max(me, other)))
        if row is None:
            return None
        return row.percent, (json.loads(row.reason_json) if row.reason_json else None)

    def their_copy(self, uid: int, subject_key: str) -> Album | None:
        copies = [a for a in self.rated_albums(uid) if a.subject_key == subject_key]
        return _recent_first(copies)[0] if copies else None

    def shared_records(self, me: int, uid: int) -> list[Album]:
        """Their rated copies of the records the caller has rated too, one per
        record (any edition), most recent first."""
        mine = {a.subject_key for a in self.rated_albums(me) if a.subject_key}
        seen: set[str] = set()
        out: list[Album] = []
        for a in _recent_first([a for a in self.rated_albums(uid) if a.subject_key in mine]):
            if a.subject_key not in seen:
                seen.add(a.subject_key)
                out.append(a)
        return out


# ---------------------------------------------------------------- endpoints

@router.get("/users/{user_id}/overlap")
def get_overlap(user_id: int, user: PressUser = Depends(current_user), session: Session = Depends(get_session)):
    authorize_view(user, user_id, session)
    return profile_overlap(Store(session), user.id, user_id)


@router.get("/overlap/friends/{user_id}")
def get_friends_overlap(user_id: int, user: PressUser = Depends(current_user),
                        session: Session = Depends(get_session)):
    authorize_view(user, user_id, session)
    return friends_overlap(Store(session), user.id, user_id)


@router.get("/overlap/sheet")
def get_sheet(user: PressUser = Depends(current_user), session: Session = Depends(get_session)):
    return serve_sheet(Store(session), user.id, datetime.now(timezone.utc), random.Random())


class SheetEvent(BaseModel):
    action: Literal["shown", "add", "open_discussion", "not_now", "open_profile"]
    target_user_id: Optional[int] = None


@router.post("/overlap/sheet/{sheet_id}/events")
def post_sheet_event(sheet_id: int, body: SheetEvent,
                     user: PressUser = Depends(current_user), session: Session = Depends(get_session)):
    sheet = session.get(OverlapSheet, sheet_id)
    if sheet is None or sheet.user_id != user.id:
        raise HTTPException(status_code=404, detail="Sheet not found")
    if _apply_event(sheet, body.action, datetime.now(timezone.utc)):
        session.add(OverlapEvent(user_id=user.id, sheet_id=sheet.id, action=body.action,
                                 target_user_id=body.target_user_id))
    session.add(sheet)
    session.commit()
    return {"ok": True}
