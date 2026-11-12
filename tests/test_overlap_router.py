import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from backend.routers.albums import _owes_sheet
from backend.routers.overlap import (
    SHEET_TTL, Store, _apply_event, _choose_sheet, _eligible, _refresh, friends_overlap,
    profile_overlap, serve_sheet,
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
    friends: dict = field(default_factory=dict)             # uid -> accepted friend ids
    rels: dict = field(default_factory=dict)                # other uid -> friends / sent / received
    blocks: dict = field(default_factory=dict)              # uid -> ids blocked either way

    def owed_sheets(self, me):
        return [s for s in self.sheets if s.user_id == me and s.status == "owed"]

    def supersede(self, ids):
        self.superseded.extend(ids)

    def album(self, album_id):
        return self.albums.get(album_id)

    def blocked(self, me):
        return set(self.blocks.get(me, ()))

    def friends_or_pending(self, me):
        return set(self.excluded)

    def friend_ids(self, uid):
        return list(self.friends.get(uid, []))

    def relationships(self, me):
        return dict(self.rels)

    def record_raters(self, subject_key, me):
        return {a.user_id: a for a in self.albums.values()
                if a.subject_key == subject_key and a.status == "rated" and a.user_id != me}

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

    def shared_records(self, me, uid):
        mine = {a.subject_key for a in self.rated_albums(me)}
        return [a for a in self.rated_albums(uid) if a.subject_key in mine]


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


def test_no_sheet_when_nobody_else_rated_it():
    # Other users have rated other records, but not this one: nobody to show, and
    # the sheet is done rather than owed, so it can't surface later.
    store = FakeStore(
        sheets=[sheet(1, 10, hours_ago=1)],
        albums={10: album(10, 1),
                20: album(20, 2, name="Channel Orange", subject="frankocean|channelorange"),
                30: album(30, 3, name="IGOR", artist="Tyler, The Creator", subject="igor", genre="Hip-Hop")},
    )
    assert serve_sheet(store, 1, NOW, random.Random(0)) is None
    assert store.superseded == [1]
    assert store.refreshed == []


def test_no_sheet_when_only_someone_blocked_rated_it():
    # Blocked either way: the pair never meet on the people sheet.
    store = FakeStore(sheets=[sheet(1, 10, hours_ago=1)], albums={10: album(10, 1), 20: album(20, 2)},
                      blocks={1: {2}})
    assert serve_sheet(store, 1, NOW, random.Random(0)) is None


def test_no_sheet_when_only_friends_rated_it():
    store = FakeStore(sheets=[sheet(1, 10, hours_ago=1)], albums={10: album(10, 1), 20: album(20, 2)},
                      excluded={2})
    assert serve_sheet(store, 1, NOW, random.Random(0)) is None
    assert store.superseded == [1]


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
        "percent": None, "reason": None, "connecting_album_id": None, "connecting_album": None,
        "shared_records": [], "shared_count": 0}


def test_missing_pair_is_fifty_with_no_reason():
    store = FakeStore()
    assert profile_overlap(store, 1, 2) == {
        "percent": 50, "reason": None, "connecting_album_id": None, "connecting_album": None,
        "shared_records": [], "shared_count": 0}
    assert store.refreshed == [(1, {2})]


def test_profile_shows_three_shared_covers_and_counts_the_rest():
    subjects = [f"a|r{i}" for i in range(4)]
    mine = {10 + i: album(10 + i, 1, name=f"R{i}", subject=k) for i, k in enumerate(subjects)}
    theirs = {20 + i: album(20 + i, 2, name=f"R{i}", subject=k, rated_hours_ago=i) for i, k in enumerate(subjects)}
    store = FakeStore(albums={**mine, **theirs, 30: album(30, 2, name="Only theirs", subject="b|x")})
    out = profile_overlap(store, 1, 2)
    assert out["shared_count"] == 4
    assert [r["id"] for r in out["shared_records"]] == [20, 21, 22]   # their copies, three shown
    assert out["connecting_album_id"] == 20


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


# ---------------------------------------------------------------- a profile's friends

def test_friends_list_is_the_viewers_overlap_highest_first():
    # Viewer 1 on user 2's profile; 2's friends are 3, 4, 5 and the viewer.
    store = FakeStore(friends={2: [3, 4, 1, 5]}, percents={3: 41.6, 4: 88.2})
    out = friends_overlap(store, 1, 2)
    assert [(r["user"]["id"], r["percent"]) for r in out] == [(1, None), (4, 88), (5, 50), (3, 42)]
    assert store.refreshed == [(1, {3, 4, 5})]           # the same live refresh as a profile pill
    assert set(out[1]["user"]) == {"id", "name", "avatar_url", "bio"}   # public_user only


def test_own_friends_list():
    store = FakeStore(friends={1: [7, 8]}, percents={8: 70.0})
    assert [(r["user"]["id"], r["percent"]) for r in friends_overlap(store, 1, 1)] == [(8, 70), (7, 50)]


def test_a_friends_list_leaves_out_anyone_blocked():
    store = FakeStore(friends={2: [7, 8]}, blocks={1: {8}})
    assert [r["user"]["id"] for r in friends_overlap(store, 1, 2)] == [7]


def test_ties_break_on_name_and_no_friends_touches_nothing():
    store = FakeStore(friends={2: [9, 6]})
    assert [r["user"]["name"] for r in friends_overlap(store, 1, 2)] == ["user6", "user9"]
    empty = FakeStore()
    assert friends_overlap(empty, 1, 2) == [] and empty.refreshed == []


def test_a_failed_refresh_serves_stored_numbers():
    store = FakeStore(friends={2: [3]}, percents={3: 61.0}, refresh_fails=True)
    assert friends_overlap(store, 1, 2)[0]["percent"] == 61 and store.rollbacks == 1


def test_each_friend_says_where_the_viewer_stands():
    store = FakeStore(friends={2: [1, 3, 4, 5, 6]}, rels={3: "friends", 4: "sent", 5: "received"})
    got = {r["user"]["id"]: r["relationship"] for r in friends_overlap(store, 1, 2)}
    assert got == {1: "self", 3: "friends", 4: "sent", 5: "received", 6: "none"}


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
