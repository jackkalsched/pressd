"""The layered baseline: how Pressd computes taste overlap (spec §3.3-3.4). Jack chose
it over matrix factorization at the checkpoint (spec §3.7) because its numbers grow
more confident the more two people share, which the factorization's did not. It reads
the same taste-matrix cells as the factorization (`worker/taste_factorize.py`, still
scored beside it nightly), so the two differ only in how they turn cells into an
agreement.

It lives in `backend/` so the web service can run it for the live path after a rating:
pure stdlib plus `statistics`, and `sqlalchemy.text` only inside the loader.

Three layers, each an agreement r in [-1, 1] with an evidence weight behind it:

1. **Direct**: songs (`s:`), album factors (`f:`) and, when its column is on, the final
   album score (`A:`) that both users have. A weighted cosine of the two users' z-scores
   over those columns, every column discounted by how many people rated it (agreeing on
   the record everyone rated says less than agreeing on one three people own), the same
   discount `taste_overlap.evidence` applies.
2. **Category**: artist, cluster, genre and subgenre aggregates both have, compared the
   same way. A song score already feeds its artist, cluster and genre, so where direct
   evidence exists the category layer's evidence is discounted by
   `EVIDENCE_K / (EVIDENCE_K + direct)`: it speaks up for pairs who share no record and
   stays quiet for pairs who share many.
3. **Album features**: each user's taste vector, the feature vectors of their records
   weighted by how they rated each one relative to their other records, compared by
   cosine. It has no shared column to count, so its evidence grows only slowly with the
   records behind the smaller vector and is capped: it can lean a pair, not decide it.

The combined r is the evidence-weighted mean of the layers, mapped through the same
`taste_overlap.to_percent` as the factorization so the two are on one curve.

The feature layer reads `albumfactors` (Claude's theme axes and distinctness) beside
the audio means. Jack kept it at the checkpoint (spec §3.7, §7): those are
measurements of the records, taken once and shared, and only the user's own ratings
decide how each one leans on them. No LLM is asked anything about a person or a pair.
"""
from __future__ import annotations

import json
import math
import statistics
from collections import defaultdict

from .taste_matrix import Cells, Rows, column_type
from .taste_overlap import EVIDENCE_K
from .trackkeys import album_key
from theme_predictor.theme_analysis import THEME_AXES

DIRECT_TYPES = frozenset({"s", "f", "A"})
CATEGORY_TYPES = frozenset({"a", "c", "g", "sg"})
FEATURE_EVIDENCE = 0.25     # evidence per record behind the smaller taste vector
FEATURE_EVIDENCE_CAP = 5.0  # half of EVIDENCE_K: the feature layer alone stays near 50

AUDIO_FEATURES = ("bpm", "key_strength", "chords_changes_rate", "loudness_db",
                  "dynamic_complexity", "danceability", "energy", "dissonance",
                  "spectral_centroid", "onset_rate", "loudness_lufs")

TasteVector = tuple[list[float], int]   # (vector, records behind it)


def load_album_features(con, rows: Rows, album_names: dict[int, str]) -> dict[int, list[float]]:
    """album_id -> feature vector: the five theme axes and distinctness from
    `albumfactors`, then the mean of each `trackaudio` feature over the copy's tracks
    (full-track analyses only, so preview features never mix in). Each feature is
    z-scored across the albums that have it; a missing one is 0, the catalog mean.
    The caller owns the connection."""
    from sqlalchemy import text

    factors: dict[str, list[float | None]] = {}
    for r in con.execute(text("SELECT album_key, theme_features, distinctness_raw FROM albumfactors")):
        axes = json.loads(r.theme_features) if r.theme_features else {}
        factors[r.album_key] = [axes.get(a) for a in THEME_AXES] + [r.distinctness_raw]
    tracks = {s.track_id for s in rows.songs}
    audio: dict[int, list[float | None]] = {}
    cols = ", ".join(AUDIO_FEATURES)
    for r in con.execute(text(f"SELECT track_id, {cols} FROM trackaudio WHERE source = 'yt_full'")):
        if r.track_id in tracks:
            audio[r.track_id] = [getattr(r, f) for f in AUDIO_FEATURES]

    tracks_by_album: dict[int, set[int]] = defaultdict(set)
    for s in rows.songs:
        tracks_by_album[s.album_id].add(s.track_id)
    raw: dict[int, list[float | None]] = {}
    for a in rows.albums:
        f = factors.get(album_key(a.artist, album_names.get(a.album_id, "")), [None] * (len(THEME_AXES) + 1))
        means: list[float | None] = []
        for i in range(len(AUDIO_FEATURES)):
            vals = [audio[t][i] for t in tracks_by_album[a.album_id] if t in audio and audio[t][i] is not None]
            means.append(statistics.fmean(vals) if vals else None)
        vec = f + means
        if any(v is not None for v in vec):
            raw[a.album_id] = vec
    return _standardize(raw)


def _standardize(raw: dict[int, list[float | None]]) -> dict[int, list[float]]:
    if not raw:
        return {}
    dims = len(next(iter(raw.values())))
    out = {k: [0.0] * dims for k in raw}
    for i in range(dims):
        vals = [v[i] for v in raw.values() if v[i] is not None]
        if len(vals) < 2:
            continue
        mean, sd = statistics.fmean(vals), statistics.pstdev(vals)
        if sd == 0:
            continue
        for k, v in raw.items():
            if v[i] is not None:
                out[k][i] = (v[i] - mean) / sd
    return out


def taste_vectors(rows: Rows, features: dict[int, list[float]]) -> dict[int, TasteVector]:
    """user -> mean of their records' feature vectors, each weighted by the record's
    z-score among their own records. A record's level is the mean of its song scores in
    `rows`, not the stored album score: the stored score contains every song, held-out
    ones included, and the hold-out test must not see them."""
    by_album: dict[tuple[int, int], list[float]] = defaultdict(list)
    for s in rows.songs:
        if s.album_id in features:
            by_album[(s.user_id, s.album_id)].append(s.score)
    per_user: dict[int, dict[int, float]] = defaultdict(dict)
    for (user, album_id), scores in by_album.items():
        per_user[user][album_id] = statistics.fmean(scores)
    out: dict[int, TasteVector] = {}
    for user, levels in per_user.items():
        mean = statistics.fmean(levels.values())
        sd = statistics.pstdev(levels.values())
        if sd == 0:
            continue
        dims = len(next(iter(features.values())))
        vec = [0.0] * dims
        for album_id, level in levels.items():
            z = (level - mean) / sd
            for i, x in enumerate(features[album_id]):
                vec[i] += z * x / len(levels)
        out[user] = (vec, len(levels))
    return out


def raters_per_column(cells: dict[int, Cells]) -> dict[str, int]:
    raters: dict[str, int] = defaultdict(int)
    for c in cells.values():
        for k in c:
            raters[k] += 1
    return dict(raters)


def _layer(a: Cells, b: Cells, keys, raters: dict[str, int]) -> tuple[float, float]:
    """(weighted cosine of the two users' z over `keys`, evidence)."""
    dot = na = nb = ev = 0.0
    for k in keys:
        w = min(a[k][1], b[k][1]) / math.log2(1 + raters.get(k, 1))
        za, zb = a[k][0], b[k][0]
        dot += w * za * zb
        na += w * za * za
        nb += w * zb * zb
        ev += w
    r = dot / math.sqrt(na * nb) if na > 0 and nb > 0 else 0.0
    return r, ev


def _cos(u: list[float], v: list[float]) -> float:
    nu = math.sqrt(sum(x * x for x in u))
    nv = math.sqrt(sum(x * x for x in v))
    return sum(x * y for x, y in zip(u, v)) / (nu * nv) if nu > 0 and nv > 0 else 0.0


def baseline_similarity(cells: dict[int, Cells],
                        vectors: dict[int, TasteVector] | None = None,
                        only: int | None = None,
                        raters: dict[str, int] | None = None,
                        ) -> dict[tuple[int, int], tuple[float, float]]:
    """(r, evidence) for every pair (a, b) with a < b among the users in `cells`, or
    only the pairs that include `only`. Rater counts come from `cells`; `raters`
    overrides them where it has a column, which is how the live path, holding a few
    users' cells, still discounts a column by everyone who rated it."""
    vectors = vectors or {}
    raters = {**raters_per_column(cells), **(raters or {})}
    uids = sorted(cells)
    out: dict[tuple[int, int], tuple[float, float]] = {}
    for i, a in enumerate(uids):
        for b in uids[i + 1:]:
            if only is not None and only not in (a, b):
                continue
            shared = cells[a].keys() & cells[b].keys()
            direct = [k for k in shared if column_type(k) in DIRECT_TYPES]
            category = [k for k in shared if column_type(k) in CATEGORY_TYPES]
            r1, e1 = _layer(cells[a], cells[b], direct, raters)
            r2, e2 = _layer(cells[a], cells[b], category, raters)
            e2 *= EVIDENCE_K / (EVIDENCE_K + e1)
            r3 = e3 = 0.0
            if a in vectors and b in vectors:
                r3 = _cos(vectors[a][0], vectors[b][0])
                e3 = min(FEATURE_EVIDENCE * min(vectors[a][1], vectors[b][1]), FEATURE_EVIDENCE_CAP)
            ev = e1 + e2 + e3
            r = (r1 * e1 + r2 * e2 + r3 * e3) / ev if ev > 0 else 0.0
            out[(a, b)] = (r, ev)
    return out
