import statistics

import pytest

from backend.taste_matrix import AGG_SHRINK_K, AlbumRow, Rows, SongRow, build_cells
from backend.taste_overlap import BRIDGE_CAP, BRIDGE_WEIGHT, EVIDENCE_K
from backend.taste_baseline import baseline_similarity
import argparse

from worker.taste_evaluate import choose_gamma, eye_test_pairs, holdout, parse_pairs, predict, user1_dependent


def album(user, aid, artist="Band", subject=None):
    return AlbumRow(user, aid, subject or f"album{aid}", artist, None, None, (), "rated", 8.0,
                    None, None, None, None)


def test_holdout_rebuilds_aggregates():
    scores = [9.0, 8.5, 7.0, 6.0, 5.5, 9.5, 4.0, 7.5, 8.0, 6.5, 3.0, 7.0, 8.5, 5.0, 6.0]
    # Albums 1 and 3 are by Band, album 2 by Other; five tracks each.
    rows = Rows(
        songs=[SongRow(1, 1 + t // 5, t, sc, None) for t, sc in enumerate(scores)],
        albums=[album(1, 1), album(1, 2, artist="Other"), album(1, 3)],
    )
    train, held = holdout(rows, frac=0.2, seed=11)
    assert len(held) == 3
    held_tracks = {s.track_id for s in held}
    assert not held_tracks & {s.track_id for s in train.songs}
    band = {s.track_id for s in rows.songs if s.album_id in (1, 3)}
    assert held_tracks & band, "the test needs a held-out Band song"

    kept = [s for s in rows.songs if s.track_id not in held_tracks]
    mean = statistics.fmean(s.score for s in kept)
    sd = statistics.pstdev(s.score for s in kept)
    band_z = [(s.score - mean) / sd for s in kept if s.track_id in band]
    n_albums = len({s.album_id for s in kept if s.track_id in band})
    expected = statistics.fmean(band_z) * n_albums / (n_albums + AGG_SHRINK_K)

    cells = build_cells(train)[1]
    assert cells["a:band"][0] == pytest.approx(expected)
    assert not any(f"s:{t}" in cells for t in held_tracks)
    # The full rows' aggregate is a different number: the held-out scores moved it.
    assert build_cells(rows)[1]["a:band"][0] != pytest.approx(expected)


def test_holdout_keeps_albums_and_is_seeded():
    rows = Rows(songs=[SongRow(1, 1, t, float(t), None) for t in range(10)], albums=[album(1, 1)])
    a, b = holdout(rows), holdout(rows)
    assert [s.track_id for s in a[1]] == [s.track_id for s in b[1]]
    assert a[0].albums == rows.albums


def test_baseline_agreeing_pair_beats_disagreeing():
    tracks = range(8)
    like = [9, 8, 7, 6, 5, 4, 3, 2]
    rows = Rows(
        songs=[SongRow(1, 1, t, like[t], None) for t in tracks]
        + [SongRow(2, 2, t, like[t] - 1, None) for t in tracks]
        + [SongRow(3, 3, t, 11 - like[t], None) for t in tracks],
        albums=[album(1, 1), album(2, 2), album(3, 3)],
    )
    sims = baseline_similarity(build_cells(rows))
    assert sims[(1, 2)][0] > 0.9
    assert sims[(1, 3)][0] < -0.9
    assert sims[(1, 2)][1] > 0


def test_predict_ignores_users_at_or_below_fifty():
    others = [(2, 1.0), (3, -1.0), (4, -2.0)]
    pct = {(1, 2): 80.0, (1, 3): 50.0, (1, 4): 20.0}
    assert predict(1, others, pct) == pytest.approx(1.0)
    assert predict(1, [(3, -1.0)], pct) is None


def test_user1_dependence():
    # Evidence of exactly EVIDENCE_K with the bridge count at its cap; user 1 is a bridge.
    assert user1_dependent(EVIDENCE_K, BRIDGE_CAP, through_user1=True)
    assert not user1_dependent(EVIDENCE_K + BRIDGE_WEIGHT, BRIDGE_CAP, through_user1=True)
    assert not user1_dependent(EVIDENCE_K, BRIDGE_CAP, through_user1=False)
    # Past the cap, losing one bridge costs nothing.
    assert not user1_dependent(EVIDENCE_K, BRIDGE_CAP + 1, through_user1=True)


def test_choose_gamma_meets_targets_when_possible():
    rs = [(-0.6 + 1.2 * i / 99, 1e9) for i in range(100)]   # evidence so large shrinkage is nil
    gamma, met = choose_gamma(rs, k=EVIDENCE_K)
    assert met
    assert 0.3 <= gamma <= 1.5


def test_parse_pairs_reads_user_ids_in_order():
    assert parse_pairs("1:84,1:12") == [(1, 84), (1, 12)]
    assert parse_pairs("7:3, ") == [(7, 3)]


@pytest.mark.parametrize("bad", ["1:1", "1-84", "a:b", "1:2:3"])
def test_parse_pairs_refuses_what_is_not_two_users(bad):
    with pytest.raises(argparse.ArgumentTypeError):
        parse_pairs(bad)


def test_eye_test_pairs_are_user_ones_highest_lowest_and_most_shared():
    # User 1 paired with 101..110 at falling percents; 120 and 121 share the most songs
    # but sit in the middle. A pair without user 1 never counts.
    pct = {(1, 100 + i): 95.0 - 5 * i for i in range(1, 11)}
    pct[(1, 120)] = 60.0
    pct[(1, 121)] = 58.0
    pct[(200, 201)] = 99.0
    tracks = {1: set(range(50)), 120: set(range(40)), 121: set(range(30)), 101: {1}, 110: {2}}
    pairs = eye_test_pairs(pct, tracks)
    assert pairs[:3] == [(1, 101), (1, 102), (1, 103)]
    assert pairs[3:6] == [(1, 110), (1, 109), (1, 108)]
    assert pairs[6:] == [(1, 120), (1, 121)]


def test_eye_test_pairs_with_few_pairs_lists_each_once():
    pct = {(1, 2): 70.0, (1, 3): 40.0}
    pairs = eye_test_pairs(pct, {1: {1, 2}, 2: {1}, 3: {2}})
    assert pairs == [(1, 2), (1, 3)]
