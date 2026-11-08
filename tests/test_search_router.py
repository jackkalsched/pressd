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
    assert ALLOWED_GROUPS == ("people", "albums", "artists", "songs")
