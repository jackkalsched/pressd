"""Bins: themed collections of records (docs/superpowers/specs/2026-11-11-bins-design.md).

The pure half — what a caller's copies say about a bin, and what a list file
holds. No database and no network, so tests/test_bins.py can pin it;
routers/bins.py does the reading and writing, worker/import_bin.py the matching.

A bin entry is a record, keyed on `subject_key`, never on anyone's copy. A
person's progress through a bin is which of those keys they hold a copy of, in
any edition: rated counts as done, listening as started, To Listen as queued.
"""
from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass
from datetime import date

# Which copy answers when someone holds two editions of one record: the most
# finished, then the newest. The same order as albums._viewer_copy.
_STATUS_RANK = {"rated": 2, "listening": 1}

# A slug is the bin's address: lowercase words joined by hyphens.
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def best_copies(copies) -> dict[str, dict]:
    """subject_key → the caller's copy that answers for it: {id, status, score}.
    `copies` are rows with subject_key, id, status and score."""
    out: dict[str, tuple] = {}
    for c in copies:
        key = c.subject_key
        if not key:
            continue
        rank = (_STATUS_RANK.get(c.status, 0), c.id)
        if key not in out or rank > out[key][0]:
            out[key] = (rank, {"id": c.id, "status": c.status, "score": c.score})
    return {k: v[1] for k, v in out.items()}


def progress(states: list[dict | None]) -> dict:
    """How far through a bin someone is, from each entry's `mine` in order — one
    per entry, so a list that names one record twice counts it twice, as the
    list does. A song counts as rated once it's scored."""
    counts = {"rated": 0, "listening": 0, "to_listen": 0}
    for c in states:
        if c and c["status"] in counts:
            counts[c["status"]] += 1
    return {**counts, "total": len(states)}


def copy_data(entry, status: str) -> dict:
    """The import payload for adding a bin entry to a library: the stored
    resolve, with the status the person chose."""
    data = json.loads(entry.tracklist_json)
    # The entry's own artist and title, which the import tool may have set to
    # the list's spelling: the copy must key to the entry, or adding a record
    # from the bin wouldn't count toward the bin.
    return {**data, "artist": entry.artist, "album_name": entry.album_name, "status": status}


# ── List files ────────────────────────────────────────────────────────────────
# A curated bin is a CSV in data/bins/<slug>.csv (rank,artist,title,year — the
# list as its source prints it) and a sibling <slug>.json with the bin's own
# fields. Kept in the repo as the bin's record of where it came from.

@dataclass
class ListRow:
    rank: int
    artist: str
    title: str
    year: int | None


@dataclass
class ListMeta:
    slug: str
    title: str
    item_type: str
    source_name: str | None
    source_url: str | None
    source_published: date | None
    description: str | None
    sort_order: int


def parse_list_csv(text: str) -> list[ListRow]:
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        year = (r.get("year") or "").strip()
        rows.append(ListRow(
            rank=int(r["rank"]),
            artist=r["artist"].strip(),
            title=r["title"].strip(),
            year=int(year) if year else None,
        ))
    ranks = [r.rank for r in rows]
    if len(set(ranks)) != len(ranks):
        raise ValueError("a rank appears twice")
    return sorted(rows, key=lambda r: r.rank)


def parse_list_meta(text: str) -> ListMeta:
    m = json.loads(text)
    if not SLUG_RE.match(m.get("slug", "")):
        raise ValueError(f"bad slug: {m.get('slug')!r}")
    if m.get("item_type", "album") not in ("album", "song"):
        raise ValueError(f"bad item_type: {m.get('item_type')!r}")
    pub = m.get("source_published")
    return ListMeta(
        slug=m["slug"],
        title=m["title"],
        item_type=m.get("item_type", "album"),
        source_name=m.get("source_name"),
        source_url=m.get("source_url"),
        source_published=date.fromisoformat(pub) if pub else None,
        description=m.get("description"),
        sort_order=int(m.get("sort_order", 0)),
    )


# ── Matching a list row to a catalog album ────────────────────────────────────

# Words that mark something other than the record as first released: a bigger
# box, a cleaned-up radio version, a live set. A remaster isn't one — it is the
# same tracklist, and for most old records the only version a catalog sells.
_EDITION = re.compile(
    r"\b(deluxe|expanded|anniversary|super|bonus|reissue|live|collector'?s|legacy|"
    r"special|platinum|demos?|sessions?|edited|clean|instrumental|karaoke|tribute)\b",
    re.I,
)


def pick_release(want_title: str, want_artist: str, want_year: int | None, hits: list[dict]) -> tuple[dict | None, str]:
    """The catalog album a list row means, from search hits shaped
    {id, title, artist, year, record_type, nb_tracks}, and how sure we are:
    'matched', 'doubtful' or 'unmatched'.

    Only hits `same_album` accepts are candidates — a same-titled record by
    someone else is worse than none — and never a single (two tracks or
    fewer), which an album bin doesn't hold. Among them: the artist exactly
    (`same_album` matches a credit by substring, so "The Beatles Complete On
    Ukulele" passes for The Beatles), then an album or EP over a compilation (Deezer files the 8-track *The Fame
    Monster* as an EP), the
    standard edition over a deluxe, edited or anniversary one (Apple means the
    17-track *Abbey Road*, not the super-deluxe box), the list's own year
    (within one), and then the fewest tracks.

    A catalog's date for an old record is usually its latest remaster's, so a
    later year is no cause for doubt. An earlier one is: a reissue can't come
    out before the record did, so that is likely a different album by the same
    name. So is an artist matched only by substring. The dry run lists both."""
    from .trackkeys import artist_key, same_album

    cands = [
        h for h in hits
        if same_album(want_title, want_artist, h.get("title") or "", h.get("artist") or "")
        and (h.get("record_type") or "album") != "single"
        and (h.get("nb_tracks") is None or h["nb_tracks"] > 2)
    ]
    if not cands:
        return None, "unmatched"

    def exact(h):
        return artist_key(h.get("artist") or "") == artist_key(want_artist)

    def year_off(h):
        if want_year is None or not h.get("year"):
            return 0
        return abs(h["year"] - want_year)

    def key(h):
        return (
            0 if exact(h) else 1,
            0 if (h.get("record_type") or "album") in ("album", "ep") else 1,
            0 if not _EDITION.search(h.get("title") or "") else 1,
            0 if year_off(h) <= 1 else 1,
            h.get("nb_tracks") or 999,
        )

    best = min(cands, key=key)
    early = want_year is not None and best.get("year") and best["year"] < want_year - 1
    return best, ("doubtful" if early or not exact(best) else "matched")


# ── Matching a list row to a song, and the album it's from ───────────────────

# A track title that names another take of the song — the list means the
# studio original.
_OTHER_TAKE = re.compile(
    r"\b(live|demo|acoustic|remix|mix|edit|instrumental|karaoke|session|unplugged|"
    r"stripped|version|mono|re-?recorded|cover|tribute)\b",
    re.I,
)
_RECORD_RANK = {"album": 0, "ep": 1, "single": 2, "compile": 3}
# An album that collects songs rather than releasing them: a song's home is
# the record it came out on, not a hits set or a holiday sampler.
_COLLECTION = re.compile(
    r"\b(greatest|hits|best of|collection|anthology|essential|essentials|singles|"
    r"christmas|acoustic|unplugged|soundtrack|playlist|now that|years)\b",
    re.I,
)
_VARIOUS = re.compile(r"^(various artists?|artisti vari|varios artistas|multi-interpr[eè]tes)$", re.I)


def pick_song_release(want_song: str, want_artist: str, want_year: int | None, hits: list[dict]) -> tuple[dict | None, str]:
    """The release a song-list row means, from track-search hits shaped
    {track_title, artist, album_id, album_title, album_artist, record_type,
    nb_tracks, year}, and how sure we are: 'matched', 'doubtful' or
    'unmatched'.

    Candidates are hits by the artist (`artist_matches`, the track's and the
    album's — a various-artists sampler is never the song's home) whose title
    is the song's (`match_title`, which folds a feat-credit or an edition tag).
    Then: the artist exactly; the studio take over a live, demo or remix one;
    an album that isn't a collection (hits, best of, Christmas…); the album it
    came out on over the single, an EP, or a compilation; no live / deluxe /
    anniversary words; the list's year (within one); the earliest; and the
    fewest tracks. A song that only ever came out as a single still matches,
    on its single. A catalog's date for an old record is often a reissue's, so
    only an artist matched by substring, another take, or a collection is
    doubtful."""
    from .trackkeys import artist_key, artist_matches, match_title

    want = match_title(want_song)
    cands = [
        h for h in hits
        if artist_matches(want_artist, h.get("artist") or "")
        and match_title(h.get("track_title") or "") == want
        and not _VARIOUS.match((h.get("album_artist") or "").strip())
        and (not h.get("album_artist") or artist_matches(want_artist, h["album_artist"]))
    ]
    if not cands:
        return None, "unmatched"

    def exact(h):
        return artist_key(h.get("artist") or "") == artist_key(want_artist)

    def year_off(h):
        if want_year is None or not h.get("year"):
            return 0
        return abs(h["year"] - want_year)

    def key(h):
        return (
            0 if exact(h) else 1,
            1 if _OTHER_TAKE.search(h.get("track_title") or "") else 0,
            1 if _COLLECTION.search(h.get("album_title") or "") else 0,
            _RECORD_RANK.get(h.get("record_type") or "album", 3),
            1 if _EDITION.search(h.get("album_title") or "") else 0,
            0 if year_off(h) <= 1 else 1,
            h.get("year") or 9999,
            h.get("nb_tracks") or 999,
        )

    best = min(cands, key=key)
    doubt = (not exact(best) or _OTHER_TAKE.search(best.get("track_title") or "")
             or _COLLECTION.search(best.get("album_title") or "") or best.get("record_type") == "compile")
    return best, ("doubtful" if doubt else "matched")


def song_states(entries, rows, me: int) -> list[dict]:
    """For a song bin: each entry's {mine, pressd_avg, pressd_raters, track_id}.

    `rows` are every copy's songs on the entries' albums (user_id, album_id,
    subject_key, status — the copy's — title, score, track_id). A song is found
    on a copy by its album's `subject_key` and its title (`match_title`, which
    folds a feat-credit or edition tag): a song bin entry may predate anyone's
    copy, so it has no track of its own to join on. The Pressd average is the
    plain mean of everyone's scores for it, as the community page's track rows
    are. Yours: your score once you've given one (status rated), else where its
    album sits in your library — the most finished copy, as best_copies picks."""
    from .trackkeys import match_title

    by_key: dict[tuple[str, str], list] = {}
    for r in rows:
        by_key.setdefault((r.subject_key, match_title(r.title or "")), []).append(r)
    copies: dict[str, list] = {}
    for r in rows:
        if r.user_id == me:
            copies.setdefault(r.subject_key, []).append(r)

    out = []
    for e in entries:
        hits = by_key.get((e.subject_key, match_title(e.song_title or "")), [])
        scored = [r for r in hits if r.score is not None]
        raters = {r.user_id for r in scored}
        mine_scored = [r for r in scored if r.user_id == me]
        if mine_scored:
            r = max(mine_scored, key=lambda r: r.album_id)
            mine = {"id": r.album_id, "status": "rated", "score": r.score}
        else:
            album = best_copies(
                [type("C", (), {"subject_key": r.subject_key, "id": r.album_id, "status": r.status, "score": None})
                 for r in copies.get(e.subject_key, [])]
            ).get(e.subject_key)
            # An unscored song on a rated copy is still to come, not rated.
            mine = {**album, "status": "listening"} if album and album["status"] == "rated" else album
        out.append({
            "mine": mine,
            "pressd_avg": round(sum(r.score for r in scored) / len(scored), 2) if scored else None,
            "pressd_raters": len(raters),
            "track_id": next((r.track_id for r in hits if r.track_id), None),
        })
    return out
