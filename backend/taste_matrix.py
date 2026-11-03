"""
Every user's ratings as cells of a taste matrix: rows are users, columns are
things a person can have an opinion on, and a cell is how far above or below
their *own* usual that opinion sits.

Why z-scores: a user who scores everything 7-9 and one who scores 3-7 agree when
they both rate a record at the top of their range. Each cell is z-scored per user
per column type, so a 9 from the first and a 7 from the second can be the same
cell. Constant scores (std 0) give z 0 rather than a division by zero.

Why aggregates (artist, cluster, genre, subgenre): two people who never heard the
same song can still like the same kind of music, and only a column that many
records feed can connect them. An aggregate is the mean of the user's song
z-scores behind it, shrunk by n / (n + AGG_SHRINK_K) where n is the number of
distinct albums, so one record doesn't make someone a fan of a genre.

Why column weights: one opinion must not count five times. A song score feeds the
artist, the cluster, the genre and the subgenre; the baseline that ships
(`taste_baseline.py`) already discounts its whole category layer by the direct
evidence behind a pair, so the aggregates carry full weight here, the checkpoint's
winning configuration (spec §3.7). The artist-cluster columns exist once per KMeans
seed, so each seed's share of the cluster weight is 1/number_of_seeds_for_that artist
(one seed reshuffling its ids barely moves anyone). The final album score is `A`: it
contains the song scores and the factors, so the spec kept it off unless the
checkpoint showed it helps, and on held-out songs it did, narrowly, for the baseline.
The factorization's health check passes its own weights (aggregates 0.25, `A` off).

Why Claude's album measurements (`m`, Jack at the checkpoint): the five theme axes
and distinctness in `albumfactors` describe records, not people, so they enter only
as each user's *lean* on them: how their album-level z-scores move with the
measurement across their rated records. Two people who share no record but both
score the narrative albums above their own usual end up with the same `m` cells,
which is the connection song and artist columns can't make. Each axis is
standardized across every measured album first, so the six are on one scale, and
the lean is shrunk like an aggregate, so one measured record says little.

Pure stdlib apart from `sqlalchemy.text` in `load_rows`: the web service imports
this module and carries no numpy.
"""
from __future__ import annotations

import json
import statistics
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import text

from .credits import song_artists
from .trackkeys import album_key, artist_key

COLUMN_WEIGHTS: dict[str, float] = {"s": 1.0, "f": 1.0, "a": 1.0, "c": 1.0, "g": 1.0, "sg": 1.0, "A": 1.0, "m": 0.5}
AGG_SHRINK_K: float = 3.0     # album-equivalents an aggregate needs to count fully

FACTORS = ("theme", "replay_value", "production", "distinctness")


@dataclass
class SongRow:
    user_id: int
    album_id: int
    track_id: int
    score: float
    song_artist: str | None


@dataclass
class AlbumRow:
    user_id: int
    album_id: int
    subject_key: str
    artist: str
    extra_artists: str | None
    genre: str | None
    subgenres: tuple[str, ...]
    status: str
    score: float | None
    theme: float | None
    replay_value: float | None
    production: float | None
    distinctness: float | None


@dataclass
class Rows:
    songs: list[SongRow] = field(default_factory=list)
    albums: list[AlbumRow] = field(default_factory=list)
    clusters: dict[str, list[tuple[int, int]]] = field(default_factory=dict)  # artist_key -> [(seed, cluster_id)]
    measures: dict[str, dict[str, float]] = field(default_factory=dict)       # subject_key -> {axis: value}


Cells = dict[str, tuple[float, float]]          # column_key -> (z value, weight)


def column_type(column_key: str) -> str:
    return column_key.split(":", 1)[0]


def load_rows(con, user_ids: set[int] | None = None) -> Rows:
    """Four SELECTs and a map. The caller owns the connection.

    `albumfactors` is keyed by `album_key`, so measures reach a record through its
    loaded copies; the first copy (by id) with a complete row speaks for the record.
    A row missing any axis is skipped, never imputed. With `user_ids` only those
    users' albums and songs load, but `measures` still covers every record in the
    catalog: `build_cells` standardizes each axis over the records in `measures`, and
    a scale drawn from a few users' records would put them on a different one from
    the nightly run they are compared against."""
    from theme_predictor.theme_analysis import THEME_AXES    # lazily, as personalize does

    scope = " AND a.user_id = ANY(:users)" if user_ids is not None else ""
    params = {"users": sorted(user_ids)} if user_ids is not None else {}

    names: dict[int, str] = {}
    album_rows = list(con.execute(text(
        "SELECT a.id, a.user_id, a.subject_key, a.artist, a.extra_artists, a.genre,"
        " a.sub_genre1, a.sub_genre2, a.sub_genre3, a.status, a.score,"
        " a.theme, a.replay_value, a.production, a.distinctness, a.album_name"
        " FROM album a WHERE a.status IN ('rated', 'listening')" + scope
    ), params))
    for r in album_rows:
        names[r.id] = r.album_name or ""
    albums = [
        AlbumRow(
            user_id=r.user_id, album_id=r.id, subject_key=r.subject_key or "",
            artist=r.artist or "", extra_artists=r.extra_artists, genre=r.genre,
            subgenres=tuple(g for g in (r.sub_genre1, r.sub_genre2, r.sub_genre3) if g),
            status=r.status, score=r.score, theme=r.theme, replay_value=r.replay_value,
            production=r.production, distinctness=r.distinctness,
        )
        for r in album_rows
    ]
    songs = [
        SongRow(user_id=r.user_id, album_id=r.album_id, track_id=r.track_id,
                score=r.score, song_artist=r.artist)
        for r in con.execute(text(
            "SELECT a.user_id, s.album_id, s.track_id, s.score, s.artist"
            " FROM song s JOIN album a ON a.id = s.album_id"
            " WHERE a.status IN ('rated', 'listening')"
            " AND s.score IS NOT NULL AND s.track_id IS NOT NULL" + scope
        ), params)
    ]
    clusters: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for r in con.execute(text("SELECT artist_key, seed, cluster_id FROM artistcluster")):
        clusters[r.artist_key].append((r.seed, r.cluster_id))
    factors: dict[str, dict[str, float]] = {}
    for r in con.execute(text(
        "SELECT album_key, theme_features, distinctness_raw FROM albumfactors"
        " WHERE theme_features IS NOT NULL AND distinctness_raw IS NOT NULL"
    )):
        try:
            axes = json.loads(r.theme_features)
        except (ValueError, TypeError):
            continue
        if not isinstance(axes, dict) or not all(isinstance(axes.get(a), (int, float)) for a in THEME_AXES):
            continue
        factors[r.album_key] = {**{a: float(axes[a]) for a in THEME_AXES}, "distinctness": float(r.distinctness_raw)}
    catalog = [(r.id, r.artist or "", names[r.id], r.subject_key or "") for r in album_rows]
    if user_ids is not None:
        catalog = [(r.id, r.artist or "", r.album_name or "", r.subject_key or "") for r in con.execute(text(
            "SELECT a.id, a.artist, a.album_name, a.subject_key FROM album a"
            " WHERE a.status IN ('rated', 'listening')"))]
    measures: dict[str, dict[str, float]] = {}
    for _id, artist, name, subject in sorted(catalog):
        m = factors.get(album_key(artist, name))
        if m is not None and subject:
            measures.setdefault(subject, m)
    return Rows(songs=songs, albums=albums, clusters=dict(clusters), measures=measures)


def _z(values: dict) -> dict:
    """key -> z against the population mean and std of the values; std 0 gives 0."""
    if not values:
        return {}
    mean = statistics.fmean(values.values())
    sd = statistics.pstdev(values.values())
    return {k: ((v - mean) / sd if sd > 0 else 0.0) for k, v in values.items()}


def _standardized_measures(measures: dict[str, dict[str, float]]) -> dict[str, dict[str, float]]:
    """subject_key -> {axis: z across every measured record}; an axis with std 0 is 0."""
    out: dict[str, dict[str, float]] = {k: {} for k in measures}
    for axis in {a for m in measures.values() for a in m}:
        for subject, z in _z({k: m[axis] for k, m in measures.items() if axis in m}).items():
            out[subject][axis] = z
    return out


def build_cells(rows: Rows, weights: dict[str, float] = COLUMN_WEIGHTS) -> dict[int, Cells]:
    albums: dict[tuple[int, int], AlbumRow] = {(a.user_id, a.album_id): a for a in rows.albums}
    albums_by_user: dict[int, list[AlbumRow]] = defaultdict(list)
    for a in rows.albums:
        albums_by_user[a.user_id].append(a)
    songs_by_user: dict[int, list[SongRow]] = defaultdict(list)
    for s in rows.songs:
        if (s.user_id, s.album_id) in albums:
            songs_by_user[s.user_id].append(s)

    measures = _standardized_measures(rows.measures) if weights.get("m", 0.0) > 0 else {}

    out: dict[int, Cells] = {}
    for user in albums_by_user:
        cells: Cells = {}
        out[user] = cells

        def put(key: str, z: float, weight: float) -> None:
            if weight > 0:
                cells[key] = (z, weight)

        # Song cells: a track scored twice by one user averages.
        by_track: dict[int, list[float]] = defaultdict(list)
        for s in songs_by_user[user]:
            by_track[s.track_id].append(s.score)
        track_z = _z({t: statistics.fmean(v) for t, v in by_track.items()})
        for t, z in track_z.items():
            put(f"s:{t}", z, weights.get("s", 0.0))

        # Factor and final-score cells come from rated albums only.
        rated = [a for a in albums_by_user[user] if a.status == "rated"]
        for name in FACTORS:
            z = _z({a.subject_key: getattr(a, name) for a in rated if getattr(a, name) is not None})
            for subject, value in z.items():
                put(f"f:{subject}:{name}", value, weights.get("f", 0.0))
        for subject, value in _z({a.subject_key: a.score for a in rated if a.score is not None}).items():
            put(f"A:{subject}", value, weights.get("A", 0.0))

        # Aggregates: song z-scores grouped by artist / cluster / genre / subgenre.
        groups: dict[str, list[tuple[float, int]]] = defaultdict(list)   # column -> [(z, album_id)]
        col_weight: dict[str, float] = {}
        seen: set[tuple[int, int]] = set()
        for s in songs_by_user[user]:
            if (s.album_id, s.track_id) in seen:
                continue
            seen.add((s.album_id, s.track_id))
            z = track_z[s.track_id]
            album = albums[(user, s.album_id)]
            columns: list[tuple[str, float]] = []
            for name in song_artists(s.song_artist, album):
                k = artist_key(name)
                if not k:
                    continue
                columns.append((f"a:{k}", weights.get("a", 0.0)))
                seeds = rows.clusters.get(k, [])
                for seed, cid in seeds:
                    columns.append((f"c:{seed}:{cid}", weights.get("c", 0.0) / len(seeds)))
            if album.genre:
                columns.append((f"g:{album.genre}", weights.get("g", 0.0)))
            for sg in album.subgenres:
                columns.append((f"sg:{sg}", weights.get("sg", 0.0)))
            for key, w in columns:
                groups[key].append((z, s.album_id))
                col_weight[key] = max(col_weight.get(key, 0.0), w)
        for key, members in groups.items():
            n = len({album_id for _, album_id in members})
            mean = statistics.fmean(z for z, _ in members)
            put(key, mean * n / (n + AGG_SHRINK_K), col_weight[key])

        # Measurement leans: a record's level is the mean song z over the user's rated
        # copies of it (two editions are one record, as in the `f` cells).
        if measures:
            by_subject: dict[str, dict[int, float]] = defaultdict(dict)
            rated_ids = {a.album_id: a.subject_key for a in rated if a.subject_key in measures}
            for s in songs_by_user[user]:
                if s.album_id in rated_ids:
                    by_subject[rated_ids[s.album_id]][s.track_id] = track_z[s.track_id]
            leans: dict[str, list[float]] = defaultdict(list)
            for subject, zs in by_subject.items():
                album_z = statistics.fmean(zs.values())
                for axis, value in measures[subject].items():
                    leans[axis].append(album_z * value)
            for axis, products in leans.items():
                n = len(products)
                put(f"m:{axis}", sum(products) / n * n / (n + AGG_SHRINK_K), weights.get("m", 0.0))
    return out
