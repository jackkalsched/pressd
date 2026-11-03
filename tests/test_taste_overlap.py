import math
import random

from backend.taste_overlap import (
    BRIDGE_CAP, BRIDGE_WEIGHT, Item, cosine, evidence, fold_in, leans, own_scale, pick_people, reason_for,
    shared_leans, smooth, to_percent,
)


def test_no_evidence_is_fifty():
    assert to_percent(0.9, 0.0) == 50.0
    assert to_percent(0.0, 100.0) == 50.0


def test_percent_is_monotone_and_bounded():
    ps = [to_percent(r / 10, 50.0) for r in range(-10, 11)]
    assert ps == sorted(ps) and 0.0 <= ps[0] and ps[-1] <= 100.0


def test_thin_evidence_moves_little():
    assert 50 < to_percent(1.0, 1.0, gamma=1.0) < 60
    assert 50 < to_percent(1.0, 1.0) < to_percent(1.0, 10.0) < to_percent(1.0, 100.0)
    assert to_percent(1.0, 1000.0) > 95


def test_fold_in_ignores_unknown_columns():
    items = {"s:1": Item(0.0, [1.0, 0.0])}
    assert fold_in({"s:1": (1.0, 1.0), "s:999": (2.0, 1.0)}, items) == fold_in({"s:1": (1.0, 1.0)}, items)


def test_fold_in_empty_is_zero_vector():
    assert fold_in({}, {"s:1": Item(0.0, [1.0, 0.0])}) == [0.0, 0.0]


def test_fold_in_solves_ridge_and_subtracts_bias():
    items = {"s:1": Item(0.5, [1.0, 0.0]), "s:2": Item(0.0, [0.0, 2.0])}
    u = fold_in({"s:1": (1.5, 3.0), "s:2": (1.0, 1.0)}, items, reg=1.0)
    # (3+1)u0 = 3*(1.5-0.5)*1 ; (1*4+1)u1 = 1*1.0*2
    assert math.isclose(u[0], 0.75) and math.isclose(u[1], 0.4)


def test_cosine():
    assert cosine([0.0, 0.0], [1.0, 2.0]) == 0.0
    assert math.isclose(cosine([1.0, 0.0], [1.0, 0.0]), 1.0)
    assert math.isclose(cosine([1.0, 0.0], [-2.0, 0.0]), -1.0)


def test_evidence_shared_columns_and_bridges():
    a = {"s:1": (1.0, 4.0), "s:2": (1.0, 1.0)}
    b = {"s:1": (1.0, 2.0), "s:3": (1.0, 1.0)}
    assert math.isclose(evidence(a, b, {"s:1": 3}, 0), 2.0 / math.log2(4))
    assert evidence(a, b, {}, 0) == 2.0 / math.log2(2)        # missing raters counts as 1
    assert math.isclose(evidence(a, b, {}, 99) - evidence(a, b, {}, 0), BRIDGE_WEIGHT * BRIDGE_CAP)


def test_smooth_jumps_after_rating_and_eases_otherwise():
    assert smooth(40.0, 80.0, rated_since=True) == 80.0
    assert smooth(40.0, 80.0, rated_since=False) == 52.0
    assert smooth(None, 80.0, rated_since=False) == 80.0


def test_pick_people_small_groups_show_everyone():
    assert sorted(pick_people([(1, 90.0), (2, 10.0)], random.Random(0))) == [1, 2]


def test_pick_people_two_top_one_bottom():
    cands = [(i, float(i)) for i in range(1, 21)]            # percent = id
    for seed in range(50):
        picked = pick_people(cands, random.Random(seed))
        assert len(picked) == 3 and len(set(picked)) == 3
        assert sum(p >= 16 for p in picked) == 2 and sum(p <= 5 for p in picked) == 1


def test_pick_people_overlapping_groups_fall_back_to_weighted_three():
    cands = [(i, 50.0) for i in range(1, 5)]                 # n=4: q=1, top has 1 person
    picked = pick_people(cands, random.Random(1))
    assert len(picked) == 3 and len(set(picked)) == 3


TITLES = {"blonde": ("Blonde", "Frank Ocean"), "igor": ("IGOR", "Tyler, The Creator")}


def test_reason_prefers_agreement():
    r = reason_for(75.0, {"blonde": 1.5, "igor": 1.5}, {"blonde": 1.4, "igor": -1.5}, [], [], TITLES)
    assert r["kind"] == "agree" and r["subject_key"] == "blonde" and r["album"] == "Blonde"
    assert r["text"] == "You both put <i>Blonde</i> near the top. Say hi."


def test_reason_split():
    r = reason_for(30.0, {"igor": 1.5}, {"igor": -1.5}, [], [], TITLES)
    assert r["kind"] == "split" and r["subject_key"] == "igor"
    assert r["text"] == "You gave <i>IGOR</i> opposite scores. Go settle it."


def test_reason_genre_only():
    r = reason_for(50.0, {}, {}, [], ["R&B"], TITLES)
    assert r == {"kind": "genre", "genre": "R&B", "text": "You both lean R&amp;B."}


def test_reason_nothing():
    assert reason_for(50.0, {}, {}, [], [], TITLES) is None


def test_reason_shared_record_is_the_last_resort():
    r = reason_for(50.0, {"blonde": 0.2, "igor": -0.4}, {"blonde": 0.1, "igor": 0.6}, [], [], TITLES)
    assert r["kind"] == "shared" and r["subject_key"] == "blonde"     # the one nearest agreement
    assert r["text"] == "You've both rated <i>Blonde</i>. Compare notes."
    assert reason_for(50.0, {"blonde": 0.2}, {"blonde": 0.1}, [], ["R&B"], TITLES)["kind"] == "genre"


def test_reason_middle_band_names_both():
    r = reason_for(55.0, {"blonde": 1.5, "igor": 1.5}, {"blonde": 1.4, "igor": -1.5}, [], [], TITLES)
    assert r["kind"] == "mixed" and r["subject_key"] == "igor" and r["agree_subject_key"] == "blonde"
    assert r["text"] == "You split on <i>IGOR</i> and agree on <i>Blonde</i>."
    # With only one of them, the middle band says that one.
    assert reason_for(55.0, {"blonde": 1.5}, {"blonde": 1.4}, [], [], TITLES)["kind"] == "agree"
    assert reason_for(55.0, {"igor": 1.5}, {"igor": -1.5}, [], [], TITLES)["kind"] == "split"


def test_reason_low_band_never_says_near_the_top():
    both = ({"blonde": 1.5, "igor": 1.5}, {"blonde": 1.4, "igor": -1.5})
    assert reason_for(24.0, *both, [], [], TITLES)["kind"] == "split"
    # Below the band an agreement of any kind is never named: not a record, an
    # artist, a genre or a record they share. A split, or nothing.
    assert reason_for(24.0, {"blonde": 1.5}, {"blonde": 1.4}, ["Frank Ocean"], ["R&B"], TITLES) is None
    assert reason_for(39.9, {"blonde": 0.2}, {"blonde": 0.1}, [], [], TITLES) is None
    assert reason_for(40.0, {"blonde": 1.5}, {"blonde": 1.4}, [], [], TITLES)["kind"] == "agree"


def test_reason_text_escapes_names_and_fields_stay_raw():
    titles = {"x": ("<b>Me & You</b>", "A&B")}
    r = reason_for(75.0, {"x": 1.5}, {"x": 1.4}, [], [], titles)
    assert r["album"] == "<b>Me & You</b>" and r["artist"] == "A&B"
    assert r["text"] == "You both put <i>&lt;b&gt;Me &amp; You&lt;/b&gt;</i> near the top. Say hi."
    r = reason_for(60.0, {}, {}, ["Simon & Garfunkel"], [], titles)
    assert r["artist"] == "Simon & Garfunkel" and r["text"] == "You both rate Simon &amp; Garfunkel highly."
    r = reason_for(60.0, {}, {}, [], ["<R&B>"], titles)
    assert r["text"] == "You both lean &lt;R&amp;B&gt;."


def test_reason_title_ending_its_own_sentence_after_escaping():
    r = reason_for(75.0, {"d": 1.5}, {"d": 1.4}, [], [], {"d": ("DAMN.", "Kendrick Lamar")})
    assert r["text"] == "You both put <i>DAMN.</i> near the top. Say hi."
    r = reason_for(50.0, {"d": 0.1}, {"d": 0.2}, [], [], {"d": ("Hi & Bye!", "X")})
    assert r["text"] == "You've both rated <i>Hi &amp; Bye!</i> Compare notes."


def test_reason_high_band_falls_through_in_order():
    r = reason_for(80.0, {}, {}, ["Frank Ocean"], ["R&B"], TITLES)
    assert r["kind"] == "artist"
    r = reason_for(80.0, {"igor": 1.5}, {"igor": -1.5}, ["Frank Ocean"], [], TITLES)
    assert r["kind"] == "split"


def test_reason_picks_closest_agreement_and_widest_split():
    a = {"blonde": 2.0, "igor": 1.0, "x": 2.0, "y": 1.0}
    b = {"blonde": 0.8, "igor": 1.0, "x": -0.5, "y": -1.0}
    titles = {**TITLES, "x": ("X", "A"), "y": ("Y", "B")}
    assert reason_for(90.0, a, b, [], [], titles)["subject_key"] == "igor"      # gap 0 beats gap 1.2
    assert reason_for(10.0, a, b, [], [], titles)["subject_key"] == "x"         # gap 2.5 beats gap 2.0


def test_reason_phrasing_is_fixed_per_seed():
    args = (75.0, {"blonde": 1.5}, {"blonde": 1.4}, [], [], TITLES)
    texts = {reason_for(*args, seed=s)["text"] for s in range(12)}
    assert len(texts) > 1 and all("<i>Blonde</i>" in t for t in texts)
    assert reason_for(*args, seed=7) == reason_for(*args, seed=7)


def test_own_scale_and_leans():
    assert own_scale({}) == {} and own_scale({"x": 3.0}) == {"x": 0.0}
    assert own_scale({"x": 1.0, "y": 1.0}) == {"x": 0.0, "y": 0.0}
    assert own_scale({"x": 1.0, "y": 3.0}) == {"x": -1.0, "y": 1.0}
    cells = {"a:frank": (0.9, 1.0), "a:sza": (0.1, 1.0), "g:R&B": (0.4, 1.0), "s:1": (2.0, 1.0)}
    assert leans(cells, "a") == {"frank": 1.0, "sza": -1.0}
    assert leans(cells, "g") == {"R&B": 0.0}


def test_shared_leans_both_above_threshold_strongest_first():
    a = {"frank": 1.2, "sza": 0.6, "drake": 2.0}
    b = {"frank": 0.7, "sza": 0.9, "drake": 0.1, "other": 3.0}
    assert shared_leans(a, b, 0.5) == ["frank", "sza"]
    assert shared_leans(a, b, 2.5) == []


def test_reason_title_ending_in_a_stop_takes_no_second_one():
    titles = {"damn": ("DAMN.", "Kendrick Lamar")}
    r = reason_for(50.0, {"damn": 0.2}, {"damn": 0.1}, [], [], titles)
    assert r["text"] == "You've both rated <i>DAMN.</i> Compare notes."
