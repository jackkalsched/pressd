import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from backend.routers.albums import _owes_sheet
from backend.routers.overlap import (
    SHEET_TTL, Store, _apply_event, _choose_sheet, _closest_record, _eligible, _refresh, profile_overlap,
    serve_sheet,
)
from backend.scoring import top_bottom_songs

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)


def sheet(sid, album_id, hours_ago, status="owed"):
    return SimpleNamespace(id=sid, user_id=1, album_id=album_id, status=status,
                           created_at=NOW - timedelta(hours=hours_ago), shown_at=None)


def album(aid, user_id, name="Blonde", artist="Frank Ocean", subject="frankocean|blonde",
          status="rated", genre="R&B", rated_hours_ago=1, extra=None):
    return SimpleNamespace(id=aid, user_id=user_id, album_name=name, artist=artist, subject_key=subject,
                           status=status, genre=genre, extra_artists=extra, album_art_url=f"art{aid}",
                           rated_at=NOW - timedelta(hours=rated_hours_ago), date_rated=None, top_song_id=None)


def song(sid, title, score):
    return SimpleNamespace(id=sid, title=title, score=score)


def user(uid):
    return SimpleNamespace(id=uid, name=f"user{uid}", avatar_url=None, bio=None)


@dataclass
class FakeStore:
    """The router's data access, in memory. Every write is recorded."""
    sheets: list = field(default_factory=list)
    albums: dict = field(default_factory=dict)              # album_id -> album
    excluded: set = field(default_factory=set)              # friends and pending
    percents: dict = field(default_factory=dict)            # other uid -> percent
    songs: dict = field(default_factory=dict)               # album_id -> songs
    superseded: list = field(default_factory=list)
    refreshed: list = field(default_factory=list)
    rows: dict = field(default_factory=dict)                # other uid -> (percent, reason)
    refresh_fails: bool = False
    rollbacks: int = 0

    def owed_sheets(self, me):
        return [s for s in self.sheets if s.user_id == me and s.status == "owed"]

    def supersede(self, ids):
        self.superseded.extend(ids)

    def album(self, album_id):
        return self.albums.get(album_id)

    def friends_or_pending(self, me):
        return set(self.excluded)

    def record_raters(self, subject_key, me):
        return {a.user_id: a for a in self.albums.values()
                if a.subject_key == subject_key and a.status == "rated" and a.user_id != me}

    def rated_users(self):
        return sorted({a.user_id for a in self.albums.values() if a.status == "rated"})

    def rated_albums(self, uid):
        return [a for a in self.albums.values() if a.user_id == uid and a.status == "rated"]

    def refresh(self, me, others, mark_fresh=True):
        self.refreshed.append((me, set(others)))
        if self.refresh_fails:
            raise RuntimeError("the live path broke")

    def rollback(self):
        self.rollbacks += 1

    def stored_percents(self, me, uids):
        return {u: self.percents[u] for u in uids if u in self.percents}

    def album_songs(self, album_id):
        return self.songs.get(album_id, [])

    def users(self, uids):
        return {u: user(u) for u in uids}

    def overlap_row(self, me, other):
        return self.rows.get(other)

    def their_copy(self, uid, subject_key):
        copies = [a for a in self.rated_albums(uid) if a.subject_key == subject_key]
        return copies[0] if copies else None

    def shared_record(self, me, uid):
        mine = {a.subject_key for a in self.rated_albums(me)}
        theirs = [a for a in self.rated_albums(uid) if a.subject_key in mine]
        return theirs[0] if theirs else None


# ---------------------------------------------------------------- owing a sheet

def test_owes_sheet_only_for_a_first_rating_of_a_new_record():
    assert _owes_sheet(True, "Blonde", 17, rated_elsewhere=False) is True
    assert _owes_sheet(False, "Blonde", 17, rated_elsewhere=False) is False
    assert _owes_sheet(True, "Nights", 2, rated_elsewhere=False) is False          # a single
    assert _owes_sheet(True, "Nights - Single", 3, rated_elsewhere=False) is False
    assert _owes_sheet(True, "Blonde (Deluxe)", 18, rated_elsewhere=True) is False  # record already rated


# ---------------------------------------------------------------- which sheet

def test_eligible_drops_self_friends_pending_and_repeats():
    assert _eligible([1, 2, 3, 3, 4], {2}, me=1) == [3, 4]


def test_latest_owed_sheet_wins():
    old, new = sheet(1, 10, hours_ago=5), sheet(2, 11, hours_ago=1)
    chosen, stale = _choose_sheet([old, new], NOW)
    assert chosen is new and stale == [1]

    store = FakeStore(sheets=[old, new], albums={10: album(10, 1), 11: album(11, 1), 20: album(20, 2)})
    out = serve_sheet(store, 1, NOW, random.Random(0))
    assert out["sheet_id"] == 2 and store.superseded == [1]


def test_sheet_older_than_48_hours_is_superseded():
    expired = sheet(1, 10, hours_ago=SHEET_TTL.total_seconds() / 3600 + 1)
    store = FakeStore(sheets=[expired], albums={10: album(10, 1), 20: album(20, 2)})
    assert serve_sheet(store, 1, NOW, random.Random(0)) is None
    assert store.superseded == [1]


def test_naive_created_at_reads_as_utc():
    s = sheet(1, 10, hours_ago=1)
    s.created_at = s.created_at.replace(tzinfo=None)
    assert _choose_sheet([s], NOW)[0] is s


def test_sheet_for_deleted_album_is_skipped():
    store = FakeStore(sheets=[sheet(5, 99, hours_ago=1)], albums={20: album(20, 2)})
    assert serve_sheet(store, 1, NOW, random.Random(0)) is None
    assert store.superseded == [5]


def test_get_never_marks_shown():
    s = sheet(1, 10, hours_ago=1)
    store = FakeStore(sheets=[s], albums={10: album(10, 1), 20: album(20, 2)})
    assert serve_sheet(store, 1, NOW, random.Random(0)) is not None
    assert s.status == "owed" and s.shown_at is None and store.superseded == []


# ---------------------------------------------------------------- who is on it

def test_no_candidates_no_sheet():
    assert _eligible([2, 3], {2, 3}, me=1) == []
    store = FakeStore(sheets=[sheet(1, 10, hours_ago=1)], excluded={2, 3},
                      albums={10: album(10, 1), 20: album(20, 2), 30: album(30, 3, name="IGOR", subject="igor")})
    assert serve_sheet(store, 1, NOW, random.Random(0)) is None


def test_raters_of_the_record_with_their_songs():
    store = FakeStore(
        sheets=[sheet(1, 10, hours_ago=1)],
        albums={10: album(10, 1), 20: album(20, 2, name="Blonde (Deluxe)"), 30: album(30, 3, name="IGOR", subject="igor")},
        percents={2: 71.6},
        songs={20: [song(1, "Nikes", 9.0), song(2, "Solo", 6.5)]},
    )
    out = serve_sheet(store, 1, NOW, random.Random(0))
    assert out["fallback"] is False
    assert out["album"] == {"id": 10, "name": "Blonde", "artist": "Frank Ocean", "art_url": "art10"}
    assert [p["user"]["id"] for p in out["people"]] == [2]          # user 3 never rated Blonde
    p = out["people"][0]
    assert p["percent"] == 72 and p["from_album"] is None
    assert p["top_song"] == {"title": "Nikes", "score": 9.0} and p["bottom_song"] == {"title": "Solo", "score": 6.5}
    assert p["user"] == {"id": 2, "name": "user2", "avatar_url": None, "bio": None}
    assert store.refreshed == [(1, {2})]


def test_raters_counts_every_other_rater_not_the_people_shown():
    others = {aid: album(aid, aid // 10) for aid in (20, 30, 40, 50, 60)}   # users 2..6
    store = FakeStore(sheets=[sheet(1, 10, hours_ago=1)], albums={10: album(10, 1), **others},
                      excluded={2, 3})                                       # two of them friends
    out = serve_sheet(store, 1, NOW, random.Random(0))
    assert out["fallback"] is False
    assert out["raters"] == 5
    assert len(out["people"]) <= 3 and not {2, 3} & {p["user"]["id"] for p in out["people"]}


def test_pair_without_a_row_is_fifty_on_the_sheet():
    store = FakeStore(sheets=[sheet(1, 10, hours_ago=1)], albums={10: album(10, 1), 20: album(20, 2)})
    assert serve_sheet(store, 1, NOW, random.Random(0))["people"][0]["percent"] == 50


def test_fallback_when_nobody_else_rated_it():
    store = FakeStore(
        sheets=[sheet(1, 10, hours_ago=1)],
        albums={10: album(10, 1),
                20: album(20, 2, name="Channel Orange", subject="frankocean|channelorange"),
                30: album(30, 3, name="IGOR", artist="Tyler, The Creator", subject="igor", genre="Hip-Hop")},
        songs={20: [song(1, "Pyramids", 9.5)]},
    )
    out = serve_sheet(store, 1, NOW, random.Random(0))
    assert out["fallback"] is True
    assert out["raters"] is None
    people = {p["user"]["id"]: p for p in out["people"]}
    assert set(people) == {2, 3}
    assert people[2]["from_album"] == "Channel Orange"
    assert people[2]["top_song"] == {"title": "Pyramids", "score": 9.5} and people[2]["bottom_song"] is None
    assert people[3]["from_album"] is None and people[3]["top_song"] is None
    assert store.refreshed == []        # the fallback never recomputes against every user


def test_closest_record_same_artist_then_genre_then_none():
    target = album(10, 1, extra='["Andre 3000"]')
    by_artist_old = album(1, 2, name="Old", subject="a", artist="André 3000", genre="Rock", rated_hours_ago=50)
    by_artist_new = album(2, 2, name="New", subject="b", artist="Frank Ocean", genre="Pop", rated_hours_ago=5)
    by_genre = album(3, 2, name="Genre", subject="c", artist="SZA", genre="R&B", rated_hours_ago=1)
    other = album(4, 2, name="Other", subject="d", artist="Slayer", genre="Metal")
    assert _closest_record([by_artist_old, by_artist_new, by_genre, other], target).id == 2
    assert _closest_record([by_artist_old], target).id == 1                 # a credited co-artist counts
    assert _closest_record([by_genre, other], target).id == 3
    assert _closest_record([other], target) is None


# ---------------------------------------------------------------- events

def test_shown_marks_once_and_not_now_clears():
    s = sheet(1, 10, hours_ago=1)
    assert _apply_event(s, "shown", NOW) is True
    assert s.status == "shown" and s.shown_at == NOW
    assert _apply_event(s, "shown", NOW + timedelta(minutes=1)) is False      # a second device: not logged again
    assert s.shown_at == NOW
    t = sheet(2, 10, hours_ago=1)
    assert _apply_event(t, "not_now", NOW) is True and t.status == "shown"
    assert _apply_event(t, "add", NOW) is True


# ---------------------------------------------------------------- the profile number

def test_self_overlap_is_null():
    class Untouchable:
        def __getattr__(self, name):
            raise AssertionError(f"self overlap touched the store: {name}")
    assert profile_overlap(Untouchable(), 1, 1) == {
        "percent": None, "reason": None, "connecting_album_id": None, "connecting_album": None}


def test_missing_pair_is_fifty_with_no_reason():
    store = FakeStore()
    assert profile_overlap(store, 1, 2) == {
        "percent": 50, "reason": None, "connecting_album_id": None, "connecting_album": None}
    assert store.refreshed == [(1, {2})]


def test_reason_points_at_their_copy():
    reason = {"kind": "agree", "subject_key": "frankocean|blonde", "album": "Blonde", "artist": "Frank Ocean",
              "text": "You both put <i>Blonde</i> near the top. Say hi."}
    store = FakeStore(albums={10: album(10, 1), 20: album(20, 2)}, rows={2: (81.7, reason)})
    out = profile_overlap(store, 1, 2)
    assert out["percent"] == 82
    assert out["reason"] == {**reason, "album_id": 20}
    assert out["connecting_album_id"] == 20
    assert out["connecting_album"] == {"id": 20, "name": "Blonde", "artist": "Frank Ocean", "art_url": "art20"}


def test_no_record_in_the_reason_connects_through_a_shared_one():
    reason = {"kind": "genre", "genre": "R&B", "text": "You both lean R&B."}
    store = FakeStore(albums={10: album(10, 1), 20: album(20, 2)}, rows={2: (60.0, reason)})
    out = profile_overlap(store, 1, 2)
    assert out["reason"] == reason and out["connecting_album_id"] == 20


# ---------------------------------------------------------------- shared helpers

def test_top_bottom_songs():
    a = SimpleNamespace(top_song_id=None)
    songs = [song(1, "A", 7.0), song(2, "B", 9.0), song(3, "C", None), song(4, "D", 5.0)]
    top, bottom = top_bottom_songs(a, songs)
    assert (top.title, bottom.title) == ("B", "D")
    assert top_bottom_songs(a, [song(1, "A", 7.0), song(3, "C", None)]) == (songs[0], None)
    assert top_bottom_songs(a, []) == (None, None)
    a.top_song_id = 1
    assert top_bottom_songs(a, songs)[0].title == "A"


@pytest.mark.parametrize("action", ["shown", "add", "open_discussion", "not_now", "open_profile"])
def test_every_action_is_accepted(action):
    from backend.routers.overlap import SheetEvent
    assert SheetEvent(action=action).action == action


def test_unknown_action_is_refused():
    from pydantic import ValidationError
    from backend.routers.overlap import SheetEvent
    with pytest.raises(ValidationError):
        SheetEvent(action="like")


# ---------------------------------------------------------------- a failing live path

def test_failed_refresh_serves_the_stored_overlap():
    reason = {"kind": "genre", "genre": "R&B", "text": "You both lean R&B."}
    store = FakeStore(albums={10: album(10, 1), 20: album(20, 2)}, rows={2: (71.6, reason)}, refresh_fails=True)
    out = profile_overlap(store, 1, 2)
    assert out["percent"] == 72 and out["reason"] == reason and out["connecting_album_id"] == 20
    assert store.rollbacks == 1


def test_failed_refresh_serves_the_sheet_at_stored_percents():
    store = FakeStore(sheets=[sheet(1, 10, 1)], albums={10: album(10, 1), 20: album(20, 2), 30: album(30, 3)},
                      percents={2: 88.0, 3: 12.0}, refresh_fails=True)
    out = serve_sheet(store, 1, NOW, random.Random(0))
    assert out is not None and out["raters"] == 2
    assert {p["user"]["id"]: p["percent"] for p in out["people"]} == {2: 88, 3: 12}
    assert store.rollbacks == 1 and store.refreshed == [(1, {2, 3})]


def test_failed_refresh_leaves_the_session_usable(monkeypatch, capsys):
    """On a real session a failed write leaves it needing a rollback (Postgres goes
    further and refuses every statement until one); after `_refresh` the request's
    next read runs."""
    from sqlalchemy import text
    from sqlmodel import Session, create_engine

    from backend.models import TasteOverlap
    import backend.routers.overlap as overlap

    engine = create_engine("sqlite://")
    TasteOverlap.__table__.create(engine)

    def broken(session, me, others, mark_fresh):
        session.add(TasteOverlap(user_id_a=1, user_id_b=2, percent=70.0))
        session.flush()
        session.execute(text("INSERT INTO tasteoverlap (user_id_a, user_id_b, percent, evidence) "
                             "VALUES (1, 2, 80, 0)"))   # the same pair again: an integrity error

    monkeypatch.setattr(overlap, "refresh_live", broken)
    with Session(engine) as session:
        _refresh(Store(session), 1, {2})
        assert session.execute(text("SELECT COUNT(*) FROM tasteoverlap")).scalar() == 0   # rolled back
    assert "refresh failed for user 1" in capsys.readouterr().out
