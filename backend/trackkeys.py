"""
Normalized dedup keys for the global track / album-corpus stores.

A track_key identifies "the same recording" across different users' imports,
whose titles differ only by feat-credits, remaster/edition suffixes, or
punctuation. Pure stdlib — safe to import from the web service, the worker,
and one-off scripts alike.
"""
import re
import unicodedata

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


def artist_key(s: str) -> str:
    """Canonical identity for an artist credit — the unit artist clustering
    groups on.

    `_clean` alone is not enough here. It strips anything outside [a-z0-9] after
    lowercasing, so a diacritic is deleted rather than folded: "Cafuné" becomes
    "cafun" while "Cafune" becomes "cafune", and the two stay separate artists.
    Decomposing to NFKD first and dropping the combining marks turns "é" into
    "e" before that substitution ever runs.

    Deliberately no "the"-prefix stripping: it would merge The Cure with Cure,
    and there is no evidence of that particular disagreement in the data.

    Not a stored key — this is a grouping key, computed on read, so it can be
    tightened later without a migration.
    """
    raw = s or ""
    folded = unicodedata.normalize("NFKD", raw.casefold())
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    return _clean(folded)


def track_key(artist: str, title: str) -> str:
    return f"{_clean(artist)}||{_clean(title)}"


def album_key(artist: str, album_name: str) -> str:
    return f"{_clean(artist)}||{_clean(album_name)}"


# Edition qualifiers in parentheses/brackets: "(Deluxe)", "[2010 Remaster]".
# _TRAIL_QUAL above only covers the dash form, which is enough for track titles
# but not for album names — catalogs disagree on edition far more than on the
# record itself, and "Ctrl (Deluxe)" has to match "Ctrl". Deliberately excludes
# soundtrack/live: those are genuinely different releases.
# `medley` earns its place the same way: one copy of Take Care spells a track
# "Cameras / Good Ones Go Interlude" and another "… (Medley)". Safe because the
# only other use of the word in the catalog is a prefix ("Medley: Pick A Bale
# Of Cotton"), which no parenthetical rule touches. Deliberately not added to
# _TRAIL_QUAL, which feeds _clean and therefore the stored track_key.
_EDITION_PAREN = re.compile(
    r"[(\[][^)\]]*\b(deluxe|remaster(ed)?|expanded|edition|version|anniversary|"
    r"explicit|bonus|mono|stereo|reissue|remix|mix|medley)\b[^)\]]*[)\]]", re.I)


# Straight and curly. Deleted rather than spaced, so "Marvin's" meets "Marvins".
_APOSTROPHE = re.compile(r"['\u2019]")

# The dash form of the qualifiers _TRAIL_QUAL misses. That regex feeds _clean
# and therefore the stored track_key, so it cannot grow; this one is applied in
# match_title alone. Take Care carries the same interlude three ways \u2014 bare,
# "(Medley)", and "- Medley" \u2014 and only the middle one is a parenthetical.
_TRAIL_QUAL_CMP = re.compile(r"\s-\s[^-]*\bmedley\b.*$", re.I)


def match_title(title: str) -> str:
    """Same-recording key for a *track* title.

    Copies of one album disagree about titles in two ways at once: whether the
    feat-credit is spelled out ("From Time" vs "From Time (feat. Jhene Aiko)")
    and whether an edition qualifier is appended ("(Album Version)"). `_clean`
    alone only handles the first, so a bare `re.sub` on punctuation — or
    `_clean` on its own — splits one track into two rows on the community view.

    There is a third disagreement: whether the apostrophe is typed at all.
    `_clean` turns every non-alphanumeric run into a space, so "Marvin's Room"
    becomes "marvin s room" and "Marvins Room" becomes "marvins room" — one
    track, two rows. Deleting apostrophes before that substitution closes it,
    and generalises to "Don't"/"Dont".

    Comparison only. `track_key` stays the stored key and must not change,
    which is why the apostrophe handling lives here rather than in `_clean`.
    """
    raw = title or ""
    stripped = _TRAIL_QUAL_CMP.sub(" ", _EDITION_PAREN.sub(" ", raw))
    stripped = _APOSTROPHE.sub("", stripped)
    return _clean(stripped) or _clean(_APOSTROPHE.sub("", raw))


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


# ── Discussion subject keys (PLAN_discussions.md §2.2) ───────────────────────
# One thread per record, per artist, per recording. The grouping question here
# is the opposite of `album_key`'s: that one is a *stored* unique key on
# albumfactors/albumprediction and must stay byte-stable, so it cannot strip
# edition qualifiers. A thread has to do the reverse — every copy of a record
# has to land in one room, or "Take Care", "(Deluxe)" and "(Deluxe Version)"
# become three rooms with one poster each.

def subject_key_album(artist: str, album_name: str) -> str:
    """Grouping key for a discussion thread about a record.

    `artist_key` rather than `_clean` on the artist side so diacritics fold
    (Cafuné/Cafune), and `_clean_album` on the name side so editions collapse.
    Computed on read, never stored on the factors tables — it can be tightened
    later without a migration, which is exactly what `album_key` cannot do.
    """
    return f"{artist_key(artist)}||{_clean_album(album_name)}"


def subject_key_artist(artist: str) -> str:
    """Grouping key for a discussion thread about an artist."""
    return artist_key(artist)
