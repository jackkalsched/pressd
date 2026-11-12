"""The tracklist merge's pure core (backend/tracklist_fill.py): no database."""
from datetime import date, datetime, timezone
from types import SimpleNamespace

from backend.tracklink import SongRow
from backend.tracklist_fill import (
    Incoming, donor_for, from_tracks, is_out, merge_copy, plan_merge, same_edition, settle, takes_catalog,
)

ART = "Lil Baby"
FRESH = ["Top Uh It", "Mr. Do Something", "Burnt Shit", "Be The One", "Ain't Goin",
         "From The Back", "All My Partnas", "My Side", "Life Of the Party (L.O.T.P)",
         "Dead Fresh", "Your Fault"]


def full_list(titles=FRESH):
    return [Incoming(t, i + 1) for i, t in enumerate(titles)]


def test_partial_prerelease_list_keeps_the_singles_place():
    plan = plan_merge([], [Incoming("Dead Fresh", 10, 157000)], ART, None, "FRESH")
    assert [(n, t.title) for n, t in plan.add] == [(10, "Dead Fresh")]
    assert plan.renumber == {}


def test_release_day_matches_the_single_and_adds_the_rest_in_order():
    existing = [SongRow(1, "Dead Fresh", ART, 10, 157000, 24394)]
    plan = plan_merge(existing, full_list(), ART, None, "FRESH")
    assert plan.matched == 1
    assert plan.renumber == {}                       # already at 10
    assert [n for n, _ in plan.add] == [1, 2, 3, 4, 5, 6, 7, 8, 9, 11]
    assert "Dead Fresh" not in [t.title for _, t in plan.add]


def test_match_is_by_recording_key_not_spelling():
    # Edition qualifiers, feat. credits, curly apostrophes and case fold into
    # one recording; nothing is added twice.
    existing = [SongRow(1, "Ain’t Goin (feat. Someone)", ART, 1, None),
                SongRow(2, "dead fresh (2026 Remaster)", ART, 2, None)]
    plan = plan_merge(existing, full_list(), ART, None, "FRESH")
    added = [t.title for _, t in plan.add]
    assert plan.matched == 2
    assert "Ain't Goin" not in added and "Dead Fresh" not in added
    assert plan.renumber == {1: 5, 2: 10}


def test_a_different_recording_is_not_matched():
    existing = [SongRow(1, "Dead Fresh (Live)", ART, 1, None)]
    plan = plan_merge(existing, [Incoming("Dead Fresh", 1)], ART, None, "FRESH")
    assert [t.title for _, t in plan.add] == ["Dead Fresh"]
    # The live take keeps its row, after the list.
    assert plan.renumber == {1: 2}


def test_unmatched_songs_are_kept_after_the_list_in_their_order():
    existing = [SongRow(7, "Bonus Two", ART, 19, None), SongRow(5, "Bonus One", ART, 18, None),
                SongRow(1, "Top Uh It", ART, 1, None)]
    plan = plan_merge(existing, full_list(FRESH[:3]), ART, None, "FRESH")
    assert plan.renumber == {5: 4, 7: 5}
    assert [t.title for _, t in plan.add] == ["Mr. Do Something", "Burnt Shit"]


def test_never_deletes_and_never_touches_a_complete_copy():
    existing = [SongRow(i + 1, t, ART, 20 + i, None) for i, t in enumerate(FRESH)]
    plan = plan_merge(existing, full_list(FRESH[:4]), ART, None, "FRESH")
    assert not plan.changes
    assert plan.renumber == {}                       # not even renumbered


def test_two_songs_of_one_title_stay_two():
    incoming = [Incoming("Karma", 1), Incoming("Karma (feat. Ice Spice)", 2)]
    plan = plan_merge([SongRow(1, "Karma", "Taylor Swift", 1, None)], incoming,
                      "Taylor Swift", None, "Midnights")
    assert [t.title for _, t in plan.add] == ["Karma (feat. Ice Spice)"]


def test_track_id_from_another_copy_matches_whatever_the_spelling():
    existing = [SongRow(1, "Dancing in the Courthouse", "X", 1, None, 55)]
    plan = plan_merge(existing, [Incoming("Dancing In The Court House", 1, track_id=55),
                                 Incoming("Next", 2, track_id=56)], "X", None, "R")
    assert [t.title for _, t in plan.add] == ["Next"]


def test_a_respelled_title_at_the_same_place_and_length_is_one_song():
    existing = [SongRow(1, "Lfe of the Prty", ART, 9, 137000)]
    incoming = full_list()
    incoming[8].duration_ms = 139000
    plan = plan_merge(existing, incoming, ART, None, "FRESH")
    assert "Life Of the Party (L.O.T.P)" not in [t.title for _, t in plan.add]
    # Without a length to confirm it, the position alone is not enough.
    plan = plan_merge(existing, full_list(), ART, None, "FRESH")
    assert "Life Of the Party (L.O.T.P)" in [t.title for _, t in plan.add]


def test_disc_restarts_fall_back_to_list_order():
    incoming = [Incoming("A", 1), Incoming("B", 2), Incoming("C", 1), Incoming("D", 2)]
    plan = plan_merge([], incoming, "X", None, "R")
    assert [n for n, _ in plan.add] == [1, 2, 3, 4]


def test_from_tracks_drops_untitled_rows():
    got = from_tracks([{"title": "A", "track_number": 1, "duration_ms": 0}, {"title": " "}, "x"])
    assert [(t.title, t.duration_ms) for t in got] == [("A", None)]


NOW = datetime(2026, 11, 12, tzinfo=timezone.utc)


def _copy(id, name, songs, status="to_listen", settled=False, release=None):
    return SimpleNamespace(id=id, album_name=name, status=status, release_date=release,
                           tracklist_settled_at=NOW if settled else None, songs=[
                               SimpleNamespace(track_id=t) for t in songs])


def test_editions_are_kept_apart():
    assert same_edition("Sweet Boy", "sweet boy")
    assert not same_edition("Take Care", "Take Care (Deluxe Version)")
    assert not same_edition("Fearless", "Fearless (Taylor's Version)")


def test_donor_is_same_edition_and_a_superset():
    short = _copy(1, "Take Care", [1, 2])
    deluxe = _copy(2, "Take Care (Deluxe)", [1, 2, 3, 4])
    other = _copy(3, "Take Care", [1, 9, 3])            # not a superset
    assert donor_for(short, [short, deluxe, other]) is None
    good = _copy(4, "Take Care", [1, 2, 3])
    assert donor_for(short, [short, deluxe, other, good]) is good


def test_donor_prefers_the_tracklist_most_copies_share():
    short = _copy(1, "R", [1])
    a, b = _copy(2, "R", [1, 2, 3]), _copy(3, "R", [1, 2, 3])
    c = _copy(4, "R", [1, 2, 3, 4])
    assert donor_for(short, [short, a, b, c]) is a


def test_a_songless_copy_takes_the_standard_edition():
    empty = _copy(1, "Take Care (Deluxe)", [])
    std, dlx = _copy(2, "Take Care", [1, 2, 3]), _copy(3, "Take Care (Deluxe Version)", [1, 2, 3, 4])
    single = _copy(4, "Take Care - Single", [1])
    assert donor_for(empty, [empty, std, dlx, single]) is std


def test_out_means_no_date_or_today_or_earlier():
    today = date(2026, 11, 12)
    assert is_out(_copy(1, "R", []), today)
    assert is_out(_copy(1, "R", [], release=today), today)
    assert not is_out(_copy(1, "R", [], release=date(2026, 11, 14)), today)


def test_a_released_copy_takes_only_a_settled_donor():
    short = _copy(1, "FRESH", [1], release=date(2026, 11, 7))
    partial = _copy(2, "FRESH", [1, 2])                  # another pre-release add
    assert donor_for(short, [short, partial], released=True) is None
    assert donor_for(short, [short, partial], released=False) is partial
    full = _copy(3, "FRESH", [1, 2, 3], settled=True)
    assert donor_for(short, [short, partial, full], released=True) is full


def test_a_settled_or_rated_copy_is_never_merged():
    for copy in (_copy(1, "R", [], settled=True), _copy(1, "R", [], status="rated")):
        assert merge_copy(None, copy, [Incoming("New", 1)], "x", dry_run=True) is None


def test_settling_needs_the_record_out_and_songs():
    out = date(2026, 11, 1)
    assert settle(None, _copy(1, "R", [5], release=out), dry_run=True)
    assert not settle(None, _copy(1, "R", [], release=out), dry_run=True)          # songless waits
    assert settle(None, _copy(1, "R", [], release=out), has_songs=True, dry_run=True)
    assert not settle(None, _copy(1, "R", [5], release=date(2099, 1, 1)), dry_run=True)
    assert not settle(None, _copy(1, "R", [5], settled=True), dry_run=True)


def test_a_catalog_list_goes_on_its_edition_or_a_songless_copy():
    assert takes_catalog(_copy(1, "Take Care", [1]), "Take Care")
    assert not takes_catalog(_copy(1, "Take Care", [1]), "Take Care (Deluxe)")
    assert takes_catalog(_copy(1, "Take Care", []), "Take Care (Deluxe)")
