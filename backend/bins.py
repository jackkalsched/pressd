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


def progress(keys: list[str], mine: dict[str, dict]) -> dict:
    """How far through a bin someone is. `keys` are its entries' subject keys
    in order — one per entry, so a list that names one record twice counts it
    twice, as the list does."""
    counts = {"rated": 0, "listening": 0, "to_listen": 0}
    for k in keys:
        c = mine.get(k)
        if c and c["status"] in counts:
            counts[c["status"]] += 1
    return {**counts, "total": len(keys)}


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
    if m.get("item_type", "album") != "album":
        raise ValueError("only album bins can be imported yet")
    pub = m.get("source_published")
    return ListMeta(
        slug=m["slug"],
        title=m["title"],
        item_type="album",
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
