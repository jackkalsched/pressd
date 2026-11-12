"""The locked thread's preview: what of a review reaches someone who hasn't
rated the record, and when Rate now is offered."""
from datetime import date

from backend.routers.discussions import PREVIEW_CHARS, can_rate, clip_body


def test_short_body_is_whole():
    assert clip_body("  Kanye's best era  ") == ("Kanye's best era", False)


def test_long_body_is_cut_at_a_word_and_marked():
    body = ("word " * 200).strip()
    text, truncated = clip_body(body)
    assert truncated
    assert len(text) <= PREVIEW_CHARS + 1
    assert text.endswith("word…")


def test_body_with_no_break_is_cut_hard():
    text, truncated = clip_body("x" * 1000)
    assert truncated and text == "x" * PREVIEW_CHARS + "…"


def test_never_more_than_the_limit_of_the_original():
    body = "a" * 250 + " " + "b" * 200
    text, _ = clip_body(body)
    assert len(text.rstrip("…")) <= PREVIEW_CHARS
    assert "b" * 50 not in text


def test_can_rate():
    today = date(2026, 11, 12)
    assert can_rate(10, None, today)
    assert can_rate(10, date(2026, 11, 12), today)
    assert not can_rate(10, date(2026, 11, 13), today)
    assert not can_rate(0, None, today)
