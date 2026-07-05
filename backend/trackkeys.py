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
