"""What a stored taste-overlap pair carries beyond its number: the reason line, and the
rule for which pairs are stored at all. Shared by the nightly run
(`worker/taste_nightly.py`) and the live path after a rating (`taste_live.py`), so a
pair written by either reads the same way.

Pure stdlib, like the rest of the taste modules the web service imports.
"""
from __future__ import annotations

import statistics
import zlib
from collections import defaultdict

from .credits import album_artists, song_artists
from .taste_matrix import Cells, Rows
from .taste_overlap import ARTIST_LEAN, GENRE_LEAN, leans, own_scale, reason_for, shared_leans
from .trackkeys import artist_key

OFF_FIFTY = 0.5             # a percent this far from 50 shows as something other than 50%


def worth_storing(percent: float) -> bool:
    """Whether a pair's row is kept. A missing row reads as 50 (spec §8)."""
    return abs(percent - 50.0) >= OFF_FIFTY


def pair_seed(a: int, b: int) -> int:
    """A stable seed for a pair's phrasing: `hash()` of a str changes per process."""
    return zlib.crc32(f"{a}:{b}".encode())


def record_levels(rows: Rows, cells: dict[int, Cells]) -> dict[int, dict[str, float]]:
    """user -> subject_key -> mean song z over the user's rated copies of the record,
    each track once (two editions are one record). The z is the user's `s:` cell, so a
    record's level is on the same scale the overlap was computed on."""
    rated = {(a.user_id, a.album_id): a.subject_key for a in rows.albums
             if a.status == "rated" and a.subject_key}
    tracks: dict[tuple[int, str], set[int]] = defaultdict(set)
    for s in rows.songs:
        subject = rated.get((s.user_id, s.album_id))
        if subject:
            tracks[(s.user_id, subject)].add(s.track_id)
    out: dict[int, dict[str, float]] = defaultdict(dict)
    for (user, subject), ts in tracks.items():
        zs = [cells[user][f"s:{t}"][0] for t in ts if f"s:{t}" in cells.get(user, {})]
        if zs:
            out[user][subject] = statistics.fmean(zs)
    return dict(out)


class PairReasons:
    """`reasons(a, b, percent)` -> the pair's reason (`taste_overlap.reason_for`). Built
    once from the loaded rows, since every pair's line draws on the same leans and
    names. Only users in `rows` can be asked about."""

    def __init__(self, rows: Rows, cells: dict[int, Cells], album_names: dict[int, str]):
        self.levels = {u: own_scale(v) for u, v in record_levels(rows, cells).items()}
        self.artist_leans = {u: leans(c, "a") for u, c in cells.items()}
        # Genres before subgenres: "You both lean R&B" before "You both lean Neo-Soul".
        self.genre_leans = {u: (leans(c, "g"), leans(c, "sg")) for u, c in cells.items()}
        self.titles: dict[str, tuple[str, str]] = {}
        self.artist_names: dict[str, str] = {}
        albums = {a.album_id: a for a in rows.albums}
        for a in sorted(rows.albums, key=lambda a: a.album_id):
            if a.subject_key:
                self.titles.setdefault(a.subject_key, (album_names.get(a.album_id, ""), a.artist))
            for name in album_artists(a):
                self.artist_names.setdefault(artist_key(name), name)
        for s in rows.songs:
            if s.album_id in albums:
                for name in song_artists(s.song_artist, albums[s.album_id]):
                    self.artist_names.setdefault(artist_key(name), name)

    def __call__(self, a: int, b: int, percent: float) -> dict | None:
        empty = ({}, {})
        artists = [self.artist_names[k]
                   for k in shared_leans(self.artist_leans.get(a, {}), self.artist_leans.get(b, {}), ARTIST_LEAN)
                   if k in self.artist_names]
        ga, gb = self.genre_leans.get(a, empty), self.genre_leans.get(b, empty)
        genres = [g for kind in (0, 1) for g in shared_leans(ga[kind], gb[kind], GENRE_LEAN)]
        return reason_for(percent, self.levels.get(a, {}), self.levels.get(b, {}), artists, genres,
                          self.titles, seed=pair_seed(a, b))
