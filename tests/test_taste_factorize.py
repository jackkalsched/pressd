import random

from backend.taste_overlap import cosine, fold_in
from worker.taste_factorize import fit

GROUPS = {1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1}


def _cells():
    rng = random.Random(3)
    out = {}
    for uid, g in GROUPS.items():
        cells = {}
        for c in range(40):
            likes = (c < 20) == (g == 0)
            z = (1.0 if likes else -1.0) + rng.gauss(0, 0.2)
            cells[f"song:{c}"] = (z, 1.0)
        out[uid] = cells
    return out


def test_same_group_scores_higher():
    m = fit(_cells())
    same, diff = [], []
    for a in GROUPS:
        for b in GROUPS:
            if a < b:
                (same if GROUPS[a] == GROUPS[b] else diff).append(cosine(m.users[a], m.users[b]))
    assert sum(same) / len(same) > sum(diff) / len(diff)


def test_fold_in_matches_fit():
    cells = _cells()
    m = fit(cells)
    for uid in GROUPS:
        assert cosine(fold_in(cells[uid], m.items, m.reg), m.users[uid]) >= 0.999


def test_deterministic():
    a, b = fit(_cells(), seed=11), fit(_cells(), seed=11)
    assert a.users == b.users


def test_agreement_on_two_rater_columns_stays_positive():
    # Two users who alone rated 30 columns and clearly agree, beside a third who rated
    # other things. A free item bias fits each column at the pair's mean and mirrors them.
    rng = random.Random(5)
    a, b = {}, {}
    for c in range(30):
        x = rng.gauss(0, 1)
        a[f"s:{c}"] = (x, 1.0)
        b[f"s:{c}"] = (0.8 * x + rng.gauss(0, 0.5), 1.0)
    third = {f"s:{100 + c}": (rng.gauss(0, 1), 1.0) for c in range(30)}
    m = fit({1: a, 2: b, 3: third})
    assert cosine(m.users[1], m.users[2]) > 0
