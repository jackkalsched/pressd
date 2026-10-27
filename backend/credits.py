"""
Who made a record, as a list rather than a string.

A collaboration has more than one artist, and the catalogs disagree on how to
say so. For Anderson .Paak & Cordae's *Heavy Is the Crown* (October 2026):

    Deezer       artist "Anderson .Paak", contributors [Anderson .Paak, Cordae]
    MusicBrainz  artist-credit [Anderson .Paak " & ", Cordae]
    iTunes       artistName "Anderson .Paak & Cordae" — one string, no list

Pressd stored whichever string the picked result carried, and every key that
groups copies of a record (`subject_key`, `album_key`, `track_key`, the thread)
is built from it. So one record picked from iTunes and the same record picked
from Deezer became two records, two sets of tracks and two threads.

The rule now: `Album.artist` is the **primary** artist alone, and the other
credited artists go in `Album.extra_artists`, filled from the catalog's own
structured credit at resolve time, and confirmed against the credit another
catalog prints (`named_in`). Identity keys stay on the primary, which
every source agrees on — and a copy that lists only the primary still joins.
For display and for the artist pages and stats, the record belongs to every
credited artist (`album_artists`).

The joined string is never split on its punctuation to find the artists. In
the library that would break AC/DC, Bob Marley & The Wailers, Catfish and the
Bottlemen, Derek & The Dominos, Joey Valence & Brae and Tyler, The Creator —
most "&"s and commas in an artist credit are part of one act's name. The list
comes from the catalog, and the one fallback that splits (`split_rest`) only
ever sees what's left of an iTunes credit after its own primary artist.

Before this, the only way to credit a second artist was a text box on the
rating screen, which people didn't fill in, or filled with song titles.

Pure stdlib apart from trackkeys, so the worker and scripts can import it.
"""
import json
import re

from .trackkeys import artist_key


def extras_of(extra_artists: str | None) -> list[str]:
    """The stored JSON list, tolerating the empty and malformed values the old
    text box left behind."""
    if not extra_artists:
        return []
    try:
        value = json.loads(extra_artists)
    except (json.JSONDecodeError, TypeError):
        return []
    return [v for v in value if isinstance(v, str) and v.strip()] if isinstance(value, list) else []


def album_artists(album) -> list[str]:
    """Every credited artist, primary first, without repeats."""
    out: list[str] = []
    seen: set[str] = set()
    for name in [album.artist or "", *extras_of(album.extra_artists)]:
        k = artist_key(name)
        if k and k not in seen:
            seen.add(k)
            out.append(name)
    return out


def song_artists(song_artist: str | None, album) -> list[str]:
    """Who a song counts toward in the per-artist stats.

    A song credited to any of the album's artists counts for all of them — on a
    collaboration the whole record is theirs, and Deezer files every track of
    *Heavy Is the Crown* under Paak alone. A song credited to someone off the
    album's credit (a soundtrack, a compilation) stays with that someone.
    """
    names = album_artists(album)
    if not song_artist:
        return names
    if len(names) > 1 and artist_key(song_artist) in {artist_key(n) for n in names}:
        return names
    return [song_artist]


def dedupe_extras(primary: str, names: list[str]) -> list[str]:
    """The co-artists in catalog order, minus the primary and any repeats.

    A name contained in the primary's, or containing it, is taken for the same
    act under another name: Deezer credits *Bully* to "Kanye West" with "Ye"
    beside it.
    """
    pk = artist_key(primary).replace(" ", "")
    seen = {pk}
    out: list[str] = []
    for n in names:
        n = (n or "").strip()
        k = artist_key(n).replace(" ", "")
        if not k or k in seen or (pk and (k in pk or pk in k)):
            continue
        seen.add(k)
        out.append(n)
    return out


def named_in(credit: str, names: list[str]) -> list[str]:
    """The names that a printed credit actually carries.

    Deezer's contributor list can't be taken alone: for a band it lists the
    members as Main beside the band (Clipse with Pusha T and Malice, Rae
    Sremmurd with Swae Lee and Slim Jxmmi, Snocaps with Waxahatchee). The
    credit iTunes prints is the one on the cover — "Clipse", but "Drake & 21
    Savage" — so a co-artist counts only where both agree.
    """
    c = artist_key(credit).replace(" ", "")
    return [n for n in names if (k := artist_key(n).replace(" ", "")) and k in c]


_JOINER = re.compile(r"\s*(?:,|&)\s*")


def split_rest(credit: str, primary: str) -> list[str] | None:
    """What follows the primary artist in a joined credit, as names.

    The fallback for an iTunes credit Deezer couldn't confirm. Only the part
    after the primary is split, and only on "," and "&": "x" and "and" are in
    too many band names. None when the credit doesn't start with the primary,
    in which case it is left whole rather than guessed at.
    """
    c, p = (credit or "").strip(), (primary or "").strip()
    if not p or not c.lower().startswith(p.lower()) or len(c) == len(p):
        return None
    rest = c[len(p):]
    if not re.match(r"\s*(?:,|&)", rest):
        return None  # the primary was a prefix of a longer name, not a credit
    return [n for n in _JOINER.split(rest) if n.strip()]
