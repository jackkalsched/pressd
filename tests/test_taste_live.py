from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from backend.taste_baseline import baseline_similarity, raters_per_column, taste_vectors
from backend.taste_live import LiveData, compute_live, is_stale
from backend.taste_matrix import AlbumRow, Rows, SongRow, build_cells, load_rows
from backend.taste_overlap import to_percent
from backend.taste_pairs import OFF_FIFTY, PairReasons

T0 = datetime(2026, 11, 3, 9, 30, tzinfo=timezone.utc)


def album(user, aid, subject, artist="Band", genre="R&B"):
    return AlbumRow(user, aid, subject, artist, None, genre, (), "rated", 8.0, None, None, None, None)


LIKE = [9.0, 8.0, 7.0, 6.0, 5.0, 4.0]


def rows():
    """Users 1 and 2 agree on record x, user 3 is their opposite, user 4 rated
    something else; every user also rated a second record."""
    songs, albums = [], []
    for u, sign in ((1, 1), (2, 1), (3, -1)):
        albums.append(album(u, 10 * u, "x"))
        songs += [SongRow(u, 10 * u, t, 5.5 + sign * (LIKE[t] - 5.5), None) for t in range(6)]
    for u in (1, 2, 3, 4):
        albums.append(album(u, 10 * u + 1, f"y{u}", artist="Other"))
        songs += [SongRow(u, 10 * u + 1, 100 + 10 * u + t, 4.0 + t, None) for t in range(3)]
    return Rows(songs=songs, albums=albums)


def features():
    return {aid: [float(aid % 7), float(aid % 3)] for aid in (10, 11, 20, 21, 30, 31, 41)}


def test_is_stale():
    assert is_stale(None, None) is False                    # never rated since the column: the nightly speaks
    assert is_stale(T0, None) is True                       # no vector row yet
    assert is_stale(T0, T0 - timedelta(minutes=1)) is True
    assert is_stale(T0, T0) is False
    assert is_stale(T0.replace(tzinfo=None), T0 + timedelta(hours=1)) is False   # naive reads as UTC


def test_live_matches_the_nightly_for_the_same_pairs():
    r = rows()
    cells = build_cells(r)
    vectors = taste_vectors(r, features())
    nightly = baseline_similarity(cells, vectors)
    names = {a.album_id: f"Album {a.album_id}" for a in r.albums}
    reasons = PairReasons(r, cells, names)

    # The live path sees only the caller and the record's raters, with the
    # catalog-wide rater counts and the others' stored vectors.
    scoped = Rows(songs=[s for s in r.songs if s.user_id in (1, 2, 3)],
                  albums=[a for a in r.albums if a.user_id in (1, 2, 3)])
    mine = {aid: v for aid, v in features().items() if aid in (10, 11)}
    data = LiveData(me=1, rows=scoped, album_names=names, features=mine,
                    vectors={u: vectors[u] for u in (2, 3)}, raters=raters_per_column(cells))
    out = compute_live(data)

    assert out.vector == vectors[1]
    got = {(a, b): (p, ev, reason) for a, b, p, ev, reason in out.pairs}
    assert set(got) == {(1, 2), (1, 3)}
    for pair in got:
        rr, ev = nightly[pair]
        assert got[pair][0] == pytest.approx(to_percent(rr, ev))
        assert got[pair][1] == pytest.approx(ev)
        assert got[pair][2] == reasons(*pair, to_percent(rr, ev))
    assert got[(1, 2)][0] > 50 > got[(1, 3)][0]


def test_live_pairs_near_fifty_are_kept_for_deletion():
    r = Rows(songs=[SongRow(1, 1, 1, 8.0, None), SongRow(2, 2, 2, 8.0, None)],
             albums=[album(1, 1, "a", artist="A", genre=None), album(2, 2, "b", artist="B", genre=None)])
    out = compute_live(LiveData(me=1, rows=r, album_names={}, features={}, vectors={}, raters={}))
    assert out.vector is None
    [(a, b, p, _ev, reason)] = out.pairs
    assert (a, b) == (1, 2) and abs(p - 50.0) < OFF_FIFTY and reason is None


def test_baseline_only_and_raters():
    r = rows()
    cells = build_cells(r)
    assert set(baseline_similarity(cells, only=1)) == {(1, 2), (1, 3), (1, 4)}
    few = baseline_similarity(cells, only=1)[(1, 2)][1]
    many = baseline_similarity(cells, only=1, raters={k: 50 for k in cells[1]})[(1, 2)][1]
    assert many < few       # a column many people rated says less


class FakeCon:
    """Answers load_rows' SELECTs from fixed tables, honouring the user scope."""

    def __init__(self, albums, songs, factors):
        self.albums, self.songs, self.factors = albums, songs, factors

    def execute(self, query, params=None):
        sql = str(query)
        users = set((params or {}).get("users", [])) or None
        if sql.startswith("SELECT a.id, a.user_id"):
            return [a for a in self.albums if users is None or a.user_id in users]
        if sql.startswith("SELECT a.user_id, s.album_id"):
            return [s for s in self.songs if users is None or s.user_id in users]
        if sql.startswith("SELECT a.id, a.artist, a.album_name, a.subject_key"):
            return list(self.albums)
        if "FROM artistcluster" in sql:
            return []
        if "FROM albumfactors" in sql:
            return self.factors
        raise AssertionError(sql)


def test_scoped_load_standardizes_measures_over_the_whole_catalog():
    import json
    from backend.trackkeys import album_key
    from theme_predictor.theme_analysis import THEME_AXES

    def a(aid, uid, name):
        return SimpleNamespace(id=aid, user_id=uid, subject_key=name, artist="Band", extra_artists=None,
                               genre=None, sub_genre1=None, sub_genre2=None, sub_genre3=None, status="rated",
                               score=8.0, theme=None, replay_value=None, production=None, distinctness=None,
                               album_name=name)
    albums = [a(1, 1, "one"), a(2, 2, "two"), a(3, 3, "three")]
    songs = [SimpleNamespace(user_id=x.user_id, album_id=x.id, track_id=x.id, score=8.0, artist=None) for x in albums]
    factors = [SimpleNamespace(album_key=album_key("Band", x.album_name),
                               theme_features=json.dumps({ax: float(x.id) for ax in THEME_AXES}),
                               distinctness_raw=float(x.id)) for x in albums]
    con = FakeCon(albums, songs, factors)
    full, scoped = load_rows(con), load_rows(con, {1})
    assert [x.user_id for x in scoped.albums] == [1]
    assert scoped.measures == full.measures          # every record's measures set the scale


def test_live_category_raters_match_the_nightly():
    """A pair sharing only an artist and a genre — no track, no record — read live
    with two users loaded must get the nightly's discount, which counts all six fans."""
    import json
    from backend.taste_live import category_raters
    from worker.taste_nightly import Loaded, compute

    songs, albums = [], []
    for u in range(1, 7):
        aid = 100 + u
        albums.append(album(u, aid, f"rec{u}", artist="Band", genre="Rock"))
        albums.append(album(u, aid + 50, f"other{u}", artist=f"Solo{u}", genre="Jazz"))
        songs += [SongRow(u, aid, 1000 * u + t, 9.0 - t * (0.5 if u < 5 else -0.5), None) for t in range(4)]
        songs += [SongRow(u, aid + 50, 2000 * u + t, 5.0, None) for t in range(3)]
    full = Rows(songs=songs, albums=albums)
    night = compute(Loaded(full, {}, {}, {}, None, {}, T0))
    stored = dict(night.items)["raters"]
    cats = category_raters(stored)
    assert cats["a:band"] == 6 and cats["g:Rock"] == 6

    scoped = Rows(songs=[s for s in songs if s.user_id in (1, 2)], albums=[a for a in albums if a.user_id in (1, 2)])
    out = compute_live(LiveData(me=1, rows=scoped, album_names={}, features={}, vectors={}, raters=cats))
    [(a, b, p, ev, _r)] = out.pairs
    r, ev_night = baseline_similarity(build_cells(full))[(1, 2)]
    assert (a, b) == (1, 2)
    assert ev == pytest.approx(ev_night) and p == pytest.approx(to_percent(r, ev_night))
    assert p == pytest.approx(night.raw[(1, 2)][0])
    # Counted over the two loaded users only, the shared artist would read stronger.
    alone = compute_live(LiveData(me=1, rows=scoped, album_names={}, features={}, vectors={}, raters={}))
    assert alone.pairs[0][3] > ev
    assert category_raters(None) == {} and category_raters("[1]") == {}
