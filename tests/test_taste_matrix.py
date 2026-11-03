import pytest

from backend.taste_matrix import AGG_SHRINK_K, COLUMN_WEIGHTS, AlbumRow, Rows, SongRow, build_cells, column_type


def album(user, aid, status="rated", artist="Band", extra=None, genre=None, subgenres=(), score=8.0,
          subject=None, **factors):
    f = dict(theme=None, replay_value=None, production=None, distinctness=None)
    f.update(factors)
    return AlbumRow(user, aid, subject or f"album{aid}", artist, extra, genre, subgenres, status, score, **f)


def song(user, aid, track, score, artist=None):
    return SongRow(user, aid, track, score, artist)


def s_cells(cells):
    return {k: v for k, v in cells.items() if column_type(k) == "s"}


def test_relative_to_own_scale():
    rows = Rows(
        songs=[song(1, 1, t, sc) for t, sc in ((1, 9), (2, 7), (3, 5))]
        + [song(2, 2, t, sc) for t, sc in ((1, 7), (2, 5), (3, 3))],
        albums=[album(1, 1), album(2, 2)],
    )
    cells = build_cells(rows)
    for t in (1, 2, 3):
        assert cells[1][f"s:{t}"][0] == pytest.approx(cells[2][f"s:{t}"][0])


def test_constant_scores_give_zero_z():
    rows = Rows(songs=[song(1, 1, t, 8.0) for t in (1, 2, 3)], albums=[album(1, 1)])
    s = s_cells(build_cells(rows)[1])
    assert len(s) == 3 and all(z == 0.0 for z, _ in s.values())


def test_collab_counts_for_each_artist():
    rows = Rows(
        songs=[song(1, 1, 1, 9), song(1, 1, 2, 5)],
        albums=[album(1, 1, artist="Anderson .Paak", extra='["Cordae"]')],
    )
    cells = build_cells(rows)[1]
    assert "a:anderson paak" in cells and "a:cordae" in cells


def test_cluster_weight_split_across_seeds():
    rows = Rows(
        songs=[song(1, 1, 1, 9), song(1, 1, 2, 5)],
        albums=[album(1, 1, artist="Band")],
        clusters={"band": [(seed, seed + 3) for seed in range(10)]},
    )
    c = {k: v for k, v in build_cells(rows)[1].items() if column_type(k) == "c"}
    assert len(c) == 10
    assert all(w == pytest.approx(COLUMN_WEIGHTS["c"] / 10) for _, w in c.values())


def test_single_album_aggregate_is_shrunk():
    rows = Rows(songs=[song(1, 1, 1, 9), song(1, 1, 2, 5), song(1, 1, 3, 9)], albums=[album(1, 1, artist="Band")])
    z = build_cells(rows)[1]
    raw = (z["s:1"][0] + z["s:2"][0] + z["s:3"][0]) / 3
    assert z["a:band"][0] == pytest.approx(raw / (1 + AGG_SHRINK_K))
    assert z["a:band"][1] == COLUMN_WEIGHTS["a"]


def test_final_score_column_follows_its_weight():
    rows = Rows(
        songs=[song(1, 1, 1, 9)],
        albums=[album(1, 1, score=9.0), album(1, 2, score=6.0)],
    )
    assert not [k for k in build_cells(rows, {**COLUMN_WEIGHTS, "A": 0.0})[1] if k.startswith("A:")]
    on = build_cells(rows, {"A": 1.0})[1]
    assert set(on) == {"A:album1", "A:album2"}
    # On by default: the checkpoint's winning baseline configuration (spec §3.7).
    assert {k for k in build_cells(rows)[1] if k.startswith("A:")} == {"A:album1", "A:album2"}


def test_factors_only_from_rated():
    rows = Rows(
        songs=[song(1, 1, 1, 9), song(1, 1, 2, 5), song(1, 2, 3, 7)],
        albums=[
            album(1, 1, theme=8, replay_value=7), album(1, 3, theme=5),
            album(1, 2, status="listening", theme=9),
        ],
    )
    cells = build_cells(rows)[1]
    assert "f:album1:theme" in cells and "f:album3:theme" in cells
    assert not any(k.startswith("f:album2") for k in cells)
    assert "s:3" in cells


def m_cells(cells):
    return {k: v for k, v in cells.items() if column_type(k) == "m"}


def measured(arcs):
    """subject_key -> a complete measurement row, varying only narrative_arc."""
    axes = ("concept_unity", "emotional_throughline", "sequencing_intent", "lyrical_depth", "distinctness")
    return {f"album{aid}": {"narrative_arc": arc, **{a: 5.0 for a in axes}} for aid, arc in arcs.items()}


def test_measure_lean_positive():
    rows = Rows(
        songs=[song(1, aid, aid * 10 + t, sc) for aid, sc in ((1, 9), (2, 9), (3, 5), (4, 5)) for t in (1, 2)],
        albums=[album(1, aid) for aid in (1, 2, 3, 4)],
        measures=measured({1: 9.0, 2: 8.0, 3: 3.0, 4: 2.0}),
    )
    assert build_cells(rows)[1]["m:narrative_arc"][0] > 0


def test_measure_lean_is_shrunk():
    rows = Rows(
        songs=[song(1, 1, 1, 9), song(1, 1, 2, 5), song(1, 1, 3, 9), song(1, 2, 4, 3)],
        albums=[album(1, 1), album(1, 2)],
        measures=measured({1: 8.0, 3: 2.0}),     # album3 is someone else's: it only sets the scale
    )
    cells = build_cells(rows)[1]
    album_z = (cells["s:1"][0] + cells["s:2"][0] + cells["s:3"][0]) / 3
    axis_std = 1.0                                # 8 against a mean of 5 and a pstdev of 3
    assert cells["m:narrative_arc"][0] == pytest.approx(album_z * axis_std / (1 + AGG_SHRINK_K))
    assert cells["m:narrative_arc"][1] == 0.5


def test_no_measures_no_cells():
    rows = Rows(
        songs=[song(1, 1, 1, 9), song(1, 1, 2, 5)],
        albums=[album(1, 1)],
        measures=measured({7: 8.0, 8: 2.0}),
    )
    assert not m_cells(build_cells(rows)[1])


def test_measures_off_with_zero_weight():
    rows = Rows(
        songs=[song(1, 1, 1, 9), song(1, 2, 2, 5)],
        albums=[album(1, 1), album(1, 2)],
        measures=measured({1: 8.0, 2: 2.0}),
    )
    assert not m_cells(build_cells(rows, {**COLUMN_WEIGHTS, "m": 0.0})[1])
