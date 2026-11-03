from datetime import datetime, timedelta, timezone

import pytest

from backend.taste_matrix import AlbumRow, Rows, SongRow, build_cells
from backend.taste_pairs import pair_seed, record_levels
from worker.taste_nightly import displayed, percentiles

T0 = datetime(2026, 11, 3, 9, 30, tzinfo=timezone.utc)


def album(user, aid, subject, status="rated"):
    return AlbumRow(user, aid, subject, "Band", None, None, (), status, 8.0, None, None, None, None)


def test_record_levels_mean_song_z_over_rated_copies():
    rows = Rows(
        songs=[SongRow(1, 1, 1, 9.0, None), SongRow(1, 1, 2, 7.0, None),
               SongRow(1, 2, 2, 7.0, None), SongRow(1, 2, 3, 3.0, None),     # deluxe copy of the same record
               SongRow(1, 3, 4, 5.0, None)],                                 # listening: not a record they rated
        albums=[album(1, 1, "blonde"), album(1, 2, "blonde"), album(1, 3, "igor", status="listening")],
    )
    cells = build_cells(rows)
    z = {t: cells[1][f"s:{t}"][0] for t in (1, 2, 3)}
    levels = record_levels(rows, cells)
    assert set(levels[1]) == {"blonde"}
    assert levels[1]["blonde"] == pytest.approx((z[1] + z[2] + z[3]) / 3)   # track 2 counted once


def test_displayed_jumps_after_a_rating_and_eases_otherwise():
    stored = (40.0, T0)
    assert displayed(80.0, stored, T0, T0 + timedelta(hours=1)) == 80.0
    assert displayed(80.0, stored, T0, T0 - timedelta(days=1)) == pytest.approx(52.0)
    assert displayed(80.0, stored, T0, None) == pytest.approx(52.0)


def test_displayed_missing_row_was_fifty():
    # A pair with no row read as 50 last night, so it eases from 50 …
    assert displayed(80.0, None, T0, None) == pytest.approx(59.0)
    # … unless one of them rated something since, and the very first run jumps.
    assert displayed(80.0, None, T0, T0 + timedelta(minutes=5)) == 80.0
    assert displayed(80.0, None, None, None) == 80.0


def test_pair_seed_is_stable():
    assert pair_seed(3, 17) == pair_seed(3, 17) != pair_seed(3, 18)
    assert isinstance(pair_seed(1, 2), int) and pair_seed(1, 2) >= 0


def test_percentiles_match_linear_interpolation():
    assert percentiles(list(range(101)), (10, 50, 90)) == [10.0, 50.0, 90.0]
    assert percentiles([0.0, 10.0], (50,)) == [5.0]
    assert percentiles([], (50,)) == []


def test_every_user_with_cells_gets_a_vector_row():
    from worker.taste_nightly import Loaded, compute
    rows = Rows(songs=[SongRow(1, 1, 1, 9.0, None), SongRow(1, 1, 2, 7.0, None), SongRow(2, 2, 1, 8.0, None)],
                albums=[album(1, 1, "blonde"), album(2, 2, "blonde")])
    c = compute(Loaded(rows, {1: "Blonde", 2: "Blonde"}, {}, {}, None, {}, T0))
    assert c.users == [(1, "[]", 0), (2, "[]", 0)]     # no features: rows that only date the computation
