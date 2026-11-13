from backend.routers.search_all import like_pattern, parse_known, ALLOWED_GROUPS
import pytest


def test_like_pattern_escapes_wildcards():
    assert like_pattern("100%_x") == "%100\\%\\_x%"
    assert like_pattern("a\\b") == "%a\\\\b%"


def test_parse_known_caps_and_validates():
    assert parse_known([{"name": "Blonde", "artist": "Frank Ocean"}]) == [("Blonde", "Frank Ocean")]
    with pytest.raises(ValueError):
        parse_known([{"name": "x", "artist": "y"}] * 51)
    with pytest.raises(ValueError):
        parse_known([{"name": "x"}])


def test_groups():
    assert ALLOWED_GROUPS == ("people", "albums", "artists", "songs", "bins")


def test_effective_limit_defaults():
    from backend.routers.search_all import effective_limit, FULL, PREVIEW
    assert effective_limit(None, None) == PREVIEW + 1
    assert effective_limit("albums", None) == FULL
    assert effective_limit("albums", 10) == 10
    assert effective_limit("albums", 999) == FULL
    assert effective_limit(None, 999) == FULL


def _bin_sql():
    from backend.routers.search_all import BIN_SEARCH_SQL
    return " ".join(str(BIN_SEARCH_SQL).split())


def test_bin_search_sql_never_admits_others_private():
    sql = _bin_sql()
    where, order = sql.split(" ORDER BY ")
    # Exactly three alternatives; only own and curated lack a visibility check.
    alts = where.split("AND ( ", 1)[1]
    own, curated, third = alts.split(" OR ", 2)
    assert own == "b.owner_id = :me"
    assert curated == "b.kind = 'curated'"
    for needle in ("b.visibility = 'published'", "b.hidden_at IS NULL", "FROM block k", "FROM binreport r"):
        assert needle in third
        assert needle not in own + curated
        assert where.count(needle) == 1


def test_bin_search_order_is_own_then_curated_then_popularity():
    order = _bin_sql().split(" ORDER BY ")[1]
    keys = [order.index(k) for k in (
        "COALESCE(b.owner_id = :me, FALSE) DESC", "(b.kind = 'curated') DESC", "FROM binview", "b.updated_at DESC")]
    assert keys == sorted(keys) and keys[0] == 0
    assert "NULLS LAST" not in order
