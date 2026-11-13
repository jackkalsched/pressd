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


def test_bin_search_sql_never_admits_others_private():
    from backend.routers.search_all import BIN_SEARCH_SQL
    sql = str(BIN_SEARCH_SQL)
    assert "b.owner_id = :me" in sql
    assert "b.visibility = 'published'" in sql
    assert "b.hidden_at IS NULL" in sql
    assert "binreport" in sql and "FROM block" in sql
    # every non-own, non-curated alternative sits inside the published branch
    assert sql.index("b.visibility = 'published'") > sql.index("b.kind = 'curated'")
