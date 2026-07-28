"""
Normalized dedup keys for the global track / album-corpus stores.

A track_key identifies "the same recording" across different users' imports,
whose titles differ only by feat-credits, remaster/edition suffixes, or
punctuation. Pure stdlib — safe to import from the web service, the worker,
and one-off scripts alike.
"""
import re

# Parenthetical/bracket segments that only carry credits: "(feat. X)", "[with Y]"
_FEAT_PAREN = re.compile(
    r"[(\[][^)\]]*\b(feat\.?|featuring|ft\.?|with)\b[^)\]]*[)\]]", re.I)
# Trailing dash qualifiers: "- 2011 Remaster", "- Deluxe Edition", "- Live at ..."
_TRAIL_QUAL = re.compile(
    r"\s-\s[^-]*\b(remaster(ed)?|deluxe|live|bonus|edition|version|remix|"
    r"mix|mono|stereo|single|demo|acoustic|extended|anniversary)\b.*$", re.I)
# Bare trailing feat-credit without parens: "Song feat. X"
_FEAT_TAIL = re.compile(r"\s\b(feat\.?|featuring|ft\.?)\b\s.*$", re.I)


def _clean(s: str) -> str:
    raw = s or ""
    s = raw.lower().replace("&", "and")
    s = _FEAT_PAREN.sub(" ", s)
    s = _TRAIL_QUAL.sub(" ", s)
    s = _FEAT_TAIL.sub(" ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    if not s:  # title was nothing but stripped qualifiers — fall back to raw
        s = re.sub(r"[^a-z0-9]+", " ", raw.lower()).strip()
    return s


def track_key(artist: str, title: str) -> str:
    return f"{_clean(artist)}||{_clean(title)}"


def album_key(artist: str, album_name: str) -> str:
    return f"{_clean(artist)}||{_clean(album_name)}"


# Edition qualifiers in parentheses/brackets: "(Deluxe)", "[2010 Remaster]".
# _TRAIL_QUAL above only covers the dash form, which is enough for track titles
# but not for album names — catalogs disagree on edition far more than on the
# record itself, and "Ctrl (Deluxe)" has to match "Ctrl". Deliberately excludes
# soundtrack/live: those are genuinely different releases.
_EDITION_PAREN = re.compile(
    r"[(\[][^)\]]*\b(deluxe|remaster(ed)?|expanded|edition|version|anniversary|"
    r"explicit|bonus|mono|stereo|reissue|remix|mix)\b[^)\]]*[)\]]", re.I)


def _clean_album(s: str) -> str:
    """_clean plus parenthesized edition qualifiers — for comparing album names
    across catalogs. Kept separate from `album_key`, whose output is a stored
    unique key that must stay stable."""
    raw = s or ""
    stripped = _EDITION_PAREN.sub(" ", raw)
    return _clean(stripped) or _clean(raw)


def artist_matches(want: str, got: str) -> bool:
    """True when two artist credits name the same act.

    Compared as a substring in either direction so a combined credit
    ("Bruno Mars, Anderson .Paak & Silk Sonic") still matches one of its
    members, which is how catalogs disagree in practice.
    """
    a, b = _clean(want).replace(" ", ""), _clean(got).replace(" ", "")
    return bool(a and b and (a in b or b in a))


def same_album(want_name: str, want_artist: str, got_name: str, got_artist: str) -> bool:
    """True when a catalog hit is the album that was asked for.

    Used to gate every lookup that resolves a name+artist to an external record
    (cover art, genre, discography imports). A same-titled album by a different
    artist is worse than no result at all, so callers must never fall back to
    the first hit without this check.
    """
    return _clean_album(want_name) == _clean_album(got_name) and artist_matches(
        want_artist, got_artist
    )
