"""The canonical genre vocabulary, and the map that gets everything into it.

Genres reach Pressd from three places that never agreed on spelling: Claude's
tagger, which is handed GENRES and stays inside it; the AOTY scraper, which
returns whatever that site's tag happens to read ("Hip-Hop/Rap", "R&B/Soul");
and imported payloads, which carry whatever their source used. Only the tagger
was ever constrained, so one genre could land under several names and split its
own chart facet — "Hip-Hop" and "Hip-Hop/Rap" filtering to different boards.

Matching ignores case, spacing and punctuation, which resolves a whole class of
these for free: "Singer/Songwriter" and "Singer-Songwriter" reduce to the same
key, so only genuinely different wording needs an entry in SYNONYMS.

Add to SYNONYMS, not to GENRES. A new canonical genre changes what the tagger
is allowed to return and what the chart facets offer, which is a bigger
decision than fixing a spelling.
"""
import re

# Mirrors the vocabulary the Claude tagger is prompted with. One source of
# truth: backend.routers.albums imports this rather than keeping its own copy.
GENRES = [
    "Hip-Hop", "R&B", "Pop", "Rock", "Electronic", "Folk",
    "Singer-Songwriter", "Country", "Jazz", "Latin", "Afrobeats",
    "Classical", "Funk", "Disco", "Blues", "Gospel",
]

# Different wording for a genre already in GENRES. Keys are written in their
# natural form and reduced the same way as everything else, so the spelling
# here is for readability, not matching.
#
# Deliberately excluded: "Alternative", "Indie Rock", "Hard Rock", "Punk",
# "Pop/Rock", "Dance". Those aren't alternate spellings of a canonical genre,
# they're narrower or adjacent ones — folding them into Rock or Electronic
# would be a reclassification, and a claim about the music rather than about
# the label. They pass through untouched.
SYNONYMS = {
    "Hip-Hop/Rap": "Hip-Hop",
    "Rap/Hip Hop": "Hip-Hop",
    "Rap": "Hip-Hop",
    "Hip Hop": "Hip-Hop",
    "R&B/Soul": "R&B",
    "RnB": "R&B",
    "Soul/R&B": "R&B",
    "Electronic/Dance": "Electronic",
    "Folk/Acoustic": "Folk",
    "Country/Folk": "Country",
    "Jazz/Blues": "Jazz",
}


def _key(value: str) -> str:
    """Case, spacing and punctuation all dropped, so the many ways of writing
    one genre collapse onto a single lookup key."""
    return re.sub(r"[^a-z0-9]", "", value.lower())


_CANONICAL_BY_KEY = {_key(g): g for g in GENRES}
_CANONICAL_BY_KEY.update({_key(k): v for k, v in SYNONYMS.items()})


def canonical_genre(raw: str | None) -> str | None:
    """The canonical spelling of `raw`, or `raw` itself when it isn't something
    we recognise.

    Unrecognised genres pass through rather than becoming None: "Bollywood" and
    "Roots Reggae" are real tags with no canonical home yet, and dropping them
    would lose information to make a list look tidier.
    """
    if raw is None:
        return None
    cleaned = raw.strip()
    if not cleaned:
        return None
    return _CANONICAL_BY_KEY.get(_key(cleaned), cleaned)
