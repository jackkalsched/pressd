import random
from datetime import date, datetime, timedelta, timezone

import pytest

from backend import user_bins as ub
from backend.bins import SLUG_RE


def test_clean_text():
    assert ub.clean_text("  a   b ", 10, required=True) == "a b"
    assert ub.clean_text("", 10, required=False) is None
    with pytest.raises(ValueError):
        ub.clean_text("x" * 281, ub.NOTE_MAX, required=False)
    with pytest.raises(ValueError):
        ub.clean_text("", 10, required=True)


def test_new_slug():
    a, b = ub.new_slug(), ub.new_slug()
    assert SLUG_RE.match(a) and a.startswith("u-") and len(a) == 12
    assert a != b


def _view(**kw):
    args = dict(bin_kind="user", owner_id=1, visibility="published", hidden_at=None,
                viewer_id=2, blocked=set(), reported=set(), bin_id=7)
    args.update(kw)
    return ub.can_view(**args)


def test_can_view():
    assert _view(visibility="private", viewer_id=1)
    assert not _view(visibility="private")
    assert _view()
    assert not _view(hidden_at=datetime.now(timezone.utc))
    assert _view(hidden_at=datetime.now(timezone.utc), visibility="private", viewer_id=1)
    assert not _view(blocked={1})
    assert not _view(reported={7})
    assert _view(bin_kind="curated", owner_id=None, visibility="private")
    assert _view(owner_id=None)


def test_addable_release():
    today = date.today()
    assert ub.addable_release(today + timedelta(days=1), 10, "X", today) == "unreleased"
    assert ub.addable_release(None, 2, "X", today) == "single"
    assert ub.addable_release(None, 10, "X", today) is None


def test_community_order():
    t1, t2 = datetime(2026, 1, 1), datetime(2026, 1, 2)
    t3 = datetime(2026, 1, 3)
    assert ub.community_order([(1, 0, t2), (2, 5, t1), (3, 5, t3)]) == [3, 2, 1]


def test_for_you_pick():
    got = ub.for_you_pick([10, 11], [1, 2, 3], random.Random(0))
    assert len(got) == 3 and got[0] == 10 and set(got[1:]) <= {1, 2, 3}
    assert ub.for_you_pick([10, 11], [], random.Random(0)) == [10, 11]


def test_validate_order():
    assert ub.validate_order([1, 2, 3], [3, 1, 2]) == [3, 1, 2]
    for bad in ([1, 2], [1, 1, 2], [1, 2, 4]):
        with pytest.raises(ValueError):
            ub.validate_order([1, 2, 3], bad)
