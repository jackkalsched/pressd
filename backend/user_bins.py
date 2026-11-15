"""User bins: the rules (docs/superpowers/specs/2026-11-13-user-bins-design.md).

The pure half, stdlib only and no database, so tests/test_user_bins.py can pin
every rule; the router does the reading and writing. A user's bin is private
until its owner publishes it; a published bin is listed to everyone, which is
why it can be reported and hidden, and why blocking its owner hides it.
"""
from __future__ import annotations

import random
import secrets
import string

MAX_ENTRIES = 100
MAX_BINS_PER_USER = 25
TITLE_MAX = 80
DESCRIPTION_MAX = 500
NOTE_MAX = 280
# Reports from this many different people hide a published bin (as a post's do).
REPORTS_TO_HIDE = 5
# "Popular" counts distinct viewers over this window.
POPULAR_DAYS = 30
# A custom cover is stored square at this size (users._normalize_image).
BIN_COVER_SIZE = (800, 800)
VISIBILITIES = ("private", "published")

# A hidden bin must not feed anything that counts: Pressd's averages, picks or
# prediction catalog. Fragments for the SQL that reads bin entries (`b` / `e`).
COUNTING_BINS_SQL = "b.hidden_at IS NULL"
COUNTING_ENTRY_JOIN = "JOIN bin b ON b.id = e.bin_id AND b.hidden_at IS NULL"

_BASE36 = string.digits + string.ascii_lowercase


def clean_text(raw, limit: int, *, required: bool) -> str | None:
    """Whitespace folded; None when empty and optional. Over `limit` is an
    error rather than a silent cut, so the client's counter and the server agree."""
    text = " ".join((raw or "").split())
    if not text:
        if required:
            raise ValueError("required")
        return None
    if len(text) > limit:
        raise ValueError(f"over {limit} characters")
    return text


def new_slug() -> str:
    """An address no one chooses, so a title never claims or leaks a name. The
    'u-' prefix keeps it clear of Pressd's own slugs."""
    return "u-" + "".join(secrets.choice(_BASE36) for _ in range(10))


def can_view(bin_kind: str, owner_id: int | None, visibility: str, hidden_at,
             viewer_id: int, blocked: set[int], reported: set[int], bin_id: int) -> bool:
    """The owner always sees their own bin, even hidden — they should learn why
    it vanished from the list rather than meet a 404. Pressd's bins are
    everyone's. Anyone else sees a published, unhidden bin whose owner they
    haven't blocked (either way) and which they haven't reported."""
    if owner_id is not None and owner_id == viewer_id:
        return True
    if bin_kind == "curated":
        return True
    if visibility != "published" or hidden_at is not None:
        return False
    if owner_id is not None and owner_id in blocked:
        return False
    return bin_id not in reported


def addable_release(release_date, track_count: int | None, album_name: str, today) -> str | None:
    """Why a record can't go in a bin, or None. A bin lists records people can
    rate: not out yet has nothing to hear, and a single isn't an album (the
    library hides them too: scoring.is_single_release)."""
    if release_date is not None and release_date > today:
        return "unreleased"
    if track_count is not None and track_count <= 2:
        return "single"
    return None


def community_order(rows: list[tuple[int, int, object]]) -> list[int]:
    """(bin_id, viewers, updated_at) → ids, most viewed first, then newest."""
    return [r[0] for r in sorted(rows, key=lambda r: (r[1], r[2]), reverse=True)]


def for_you_pick(curated: list[int], community: list[int], rng: random.Random,
                 n: int = 3) -> list[int]:
    """For You's BINS row: Pressd's first bin leads, then random community bins
    (so the row changes between visits), and Pressd's next fill any shortfall."""
    out = curated[:1]
    pool = list(community)
    rng.shuffle(pool)
    out += pool[: n - len(out)]
    for cid in curated[1:]:
        if len(out) >= n:
            break
        out.append(cid)
    return out


def validate_order(current_ids: list[int], requested: list[int]) -> list[int]:
    """A reorder must name exactly the bin's entries, each once."""
    if len(requested) != len(set(requested)) or set(requested) != set(current_ids):
        raise ValueError("order must list each entry exactly once")
    return list(requested)
