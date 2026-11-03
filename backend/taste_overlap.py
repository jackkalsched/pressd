"""Taste overlap between two users, from their taste-matrix cells (`taste_matrix.py`).

Pure stdlib on purpose: the web service imports this module and carries no numpy
(same constraint as `theme_predictor/personalize.py`).

What ships is the layered baseline (`taste_baseline.py`, Jack at the checkpoint, spec
§3.7): it turns two users' cells into a raw agreement `r` with an evidence weight, and
`to_percent` turns `r` into the 0-100 figure shown, **held near 50 until there is
evidence behind it**. The fold-in below serves the factorization, which is no longer
shown but is still scored beside the baseline every night (`worker/taste_health.py`),
so the choice can be re-made as records gather raters. Two users who each rated one shared album and agreed perfectly
have `r` = 1 and nothing to say about their taste, so the percent is shrunk by
`ev / (ev + k)` rather than trusted. The cosine is never replaced by anything an LLM
says; the percentage is the model's output.

Cells are already z-scored per column type, so there is no user bias term here; only
the item bias is removed before solving.

`reason_for` is the line under the number (spec §5.3): a fixed template naming
something real the pair has in common, never an LLM's words. It follows the number's
band, so a 24% never says "you both put *X* near the top", and which of a few fixed
phrasings a pair gets is set by its seed, so the line doesn't change wording night to
night.
"""
from __future__ import annotations

import html
import math
import random
import statistics
from dataclasses import dataclass

from .taste_matrix import Cells

RANK = 4                    # replaced by the checkpoint's choice
REG = 5.0                   # ridge on the fold-in solve
EVIDENCE_K = 10.0           # shared weight at which r keeps half its strength
BRIDGE_WEIGHT = 0.5         # evidence per third user who shares a column with both
BRIDGE_CAP = 10
GAMMA = 0.5                 # curve exponent: the checkpoint's choice for the baseline (spec §3.7)
SMOOTH_ALPHA = 0.3          # how far a displayed percent moves toward a new one per night

# The reason line, on each user's own scale (`own_scale`): "near the top" is a record
# both put three quarters of a spread above their other records, and "opposite" is two
# spreads apart: one loved it, the other didn't, by their own standards.
AGREE_Z = 0.75
SPLIT_GAP = 2.0
ARTIST_LEAN = 0.5           # both users' artist lean, among their artists, at least this
GENRE_LEAN = 0.25           # both users' genre lean, among their genres, at least this
HIGH_BAND = 70.0            # at or above: agreement first
LOW_BAND = 40.0             # below: a split first, and never an agreement


@dataclass
class Item:
    bias: float
    vector: list[float]


def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting. `a` is ridge-regularised, so it is
    positive definite and never singular."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[piv] = m[piv], m[col]
        for r in range(col + 1, n):
            f = m[r][col] / m[col][col]
            for c in range(col, n + 1):
                m[r][c] -= f * m[col][c]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = (m[i][n] - sum(m[i][j] * x[j] for j in range(i + 1, n))) / m[i][i]
    return x


def fold_in(cells: Cells, items: dict[str, Item], reg: float = REG) -> list[float]:
    """Solve (Σ w·v·vᵀ + reg·I) u = Σ w·(z − bias)·v over the columns the user has
    that the fitted model knows. Columns the model has never seen are ignored."""
    d = len(next(iter(items.values())).vector) if items else RANK
    a = [[reg if i == j else 0.0 for j in range(d)] for i in range(d)]
    b = [0.0] * d
    shared = 0
    for key, (z, w) in cells.items():
        item = items.get(key)
        if item is None:
            continue
        shared += 1
        v = item.vector
        for i in range(d):
            b[i] += w * (z - item.bias) * v[i]
            for j in range(d):
                a[i][j] += w * v[i] * v[j]
    if not shared:
        return [0.0] * d
    return _solve(a, b)


def cosine(u: list[float], v: list[float]) -> float:
    nu = math.sqrt(sum(x * x for x in u))
    nv = math.sqrt(sum(x * x for x in v))
    if nu == 0.0 or nv == 0.0:
        return 0.0
    return sum(x * y for x, y in zip(u, v)) / (nu * nv)


def evidence(a: Cells, b: Cells, raters: dict[str, int], bridges: int) -> float:
    """How much two users actually have in common. A shared column counts for the
    smaller of the two weights, discounted by how many people rated it: agreeing on a
    record everyone has rated says less than agreeing on an obscure one. Third users
    who share a column with both add a little, capped."""
    total = 0.0
    for key in a.keys() & b.keys():
        total += min(a[key][1], b[key][1]) / math.log2(1 + raters.get(key, 1))
    return total + BRIDGE_WEIGHT * min(bridges, BRIDGE_CAP)


def to_percent(r: float, ev: float, k: float = EVIDENCE_K, gamma: float = GAMMA) -> float:
    rs = r * ev / (ev + k)
    return 50.0 + 50.0 * math.copysign(abs(rs) ** gamma, rs)


def smooth(previous: float | None, new: float, rated_since: bool, alpha: float = SMOOTH_ALPHA) -> float:
    """A percent that moves only because the night's fit drifted eases toward the new
    value; one that moved because the user rated something jumps there, so their own
    action is visible at once."""
    if previous is None or rated_since:
        return new
    return previous + alpha * (new - previous)


def pick_people(candidates: list[tuple[int, float]], rng: random.Random) -> list[int]:
    """Three people to show: two from the top quarter and one from the bottom quarter
    by percent, so the sheet shows who is close and who is far. Groups of three or
    fewer show everyone. When the quarters can't supply that shape, three distinct
    people weighted by percent + 1."""
    n = len(candidates)
    if n <= 3:
        return [uid for uid, _ in candidates]
    ranked = sorted(candidates, key=lambda c: (-c[1], c[0]))
    q = math.ceil(n / 4)
    top, bottom = ranked[:q], ranked[n - q:]
    if len(top) >= 2 and q * 2 <= n:
        return [uid for uid, _ in rng.sample(top, 2)] + [rng.choice(bottom)[0]]
    pool = list(candidates)
    picked: list[int] = []
    for _ in range(3):
        uid, _pct = rng.choices(pool, weights=[p + 1.0 for _, p in pool])[0]
        picked.append(uid)
        pool = [c for c in pool if c[0] != uid]
    return picked


def own_scale(values: dict[str, float]) -> dict[str, float]:
    """Each value as a z among the user's own values of that kind; fewer than two, or
    all equal, are 0. Record levels and aggregates are means of song z-scores, so their
    spread is well under 1 and shrinks with every song averaged in: on that raw scale
    not one pair in production had a record both rated 0.75 above their usual. On
    this one, "near the top" means near the top of their own records."""
    if len(values) < 2:
        return {k: 0.0 for k in values}
    mean = statistics.fmean(values.values())
    sd = statistics.pstdev(values.values())
    return {k: (v - mean) / sd if sd > 0 else 0.0 for k, v in values.items()}


def leans(cells: Cells, prefix: str) -> dict[str, float]:
    """A user's `prefix:` aggregate cells (artist, genre …) on their own scale, keyed
    without the prefix."""
    head = prefix + ":"
    return own_scale({k[len(head):]: z for k, (z, _w) in cells.items() if k.startswith(head)})


def shared_leans(a: dict[str, float], b: dict[str, float], threshold: float) -> list[str]:
    """The keys where both users lean at least `threshold`, strongest shared lean (the
    smaller of the two) first."""
    keys = [k for k in a.keys() & b.keys() if a[k] >= threshold and b[k] >= threshold]
    keys.sort(key=lambda k: (-min(a[k], b[k]), k))
    return keys


AGREE_TEXT = ("You both put <i>{album}</i> near the top. Say hi.",
              "<i>{album}</i> is a high point for you both. Say hi.",
              "You both rate <i>{album}</i> above your usual. Say hi.")
SPLIT_TEXT = ("You gave <i>{album}</i> opposite scores. Go settle it.",
              "You landed on opposite ends of <i>{album}</i>. Go settle it.",
              "<i>{album}</i> divides you two. Go settle it.")
MIXED_TEXT = ("You split on <i>{album}</i> and agree on <i>{agree}</i>.",
              "You agree on <i>{agree}</i> and split on <i>{album}</i>.")
ARTIST_TEXT = ("You both rate {artist} highly.",
               "You both rank {artist} above your usual.")
GENRE_TEXT = ("You both lean {genre}.",)
SHARED_TEXT = ("You've both rated <i>{album}</i>. Compare notes.",
               "<i>{album}</i> is on both your shelves. Compare notes.")


def reason_for(percent: float,
               a_records: dict[str, float], b_records: dict[str, float],
               shared_artists: list[str], shared_genres: list[str],
               titles: dict[str, tuple[str, str]], seed: int = 0) -> dict | None:
    """The reason line for a pair. `*_records` map subject_key -> the user's level on
    the record (mean song z) on their own scale (`own_scale`); `shared_artists` /
    `shared_genres` are display names both lean toward, strongest first
    (`shared_leans`); `titles` maps subject_key ->
    (album name, artist). `seed` picks the phrasing; the nightly job passes a stable
    hash of the pair. Album names are wrapped in `<i>` and nothing else is markup:
    every interpolated name is HTML-escaped in `text`, so a record called
    "<b>Me & You</b>" can't become markup. The structured fields (`album`, `artist`,
    `genre`, `agree_album`) stay raw; clients render from those, or tokenise the
    literal `<i>…</i>` in `text`, and never inject it as HTML.

    At or above HIGH_BAND: the record they agree on most, then the order below. In the
    middle: a record they split on and one they agree on together, else whichever
    exists. Below LOW_BAND: the split, or nothing — an agreement of any kind (a record,
    an artist, a genre, a record they share) never sits under a low number. Otherwise,
    after the records, an artist both rate highly, then a genre both lean toward, then
    any record they have both rated (the one nearest agreement), then None."""
    shared = [k for k in sorted(a_records.keys() & b_records.keys()) if k in titles]
    agreed = [k for k in shared if a_records[k] >= AGREE_Z and b_records[k] >= AGREE_Z]
    split = [k for k in shared if abs(a_records[k] - b_records[k]) >= SPLIT_GAP]
    agree_key = min(agreed, key=lambda k: abs(a_records[k] - b_records[k]), default=None)
    split_key = max(split, key=lambda k: abs(a_records[k] - b_records[k]), default=None)

    def text(templates: tuple[str, ...], **fields) -> str:
        safe = {k: html.escape(v, quote=False) for k, v in fields.items()}
        out = templates[seed % len(templates)].format(**safe)
        for v in safe.values():         # "DAMN." ends its own sentence
            if v and v[-1] in ".!?":
                out = out.replace(f"{v}</i>.", f"{v}</i>")
        return out

    def record(kind: str, key: str, templates: tuple[str, ...]) -> dict:
        album, artist = titles[key]
        return {"kind": kind, "subject_key": key, "album": album, "artist": artist,
                "text": text(templates, album=album)}

    def agree() -> dict | None:
        return record("agree", agree_key, AGREE_TEXT) if agree_key else None

    def disagree() -> dict | None:
        return record("split", split_key, SPLIT_TEXT) if split_key else None

    def mixed() -> dict | None:
        if not (agree_key and split_key):
            return None
        album, artist = titles[split_key]
        agree_album = titles[agree_key][0]
        return {"kind": "mixed", "subject_key": split_key, "album": album, "artist": artist,
                "agree_subject_key": agree_key, "agree_album": agree_album,
                "text": text(MIXED_TEXT, album=album, agree=agree_album)}

    if percent >= HIGH_BAND:
        order = (agree, disagree)
    elif percent >= LOW_BAND:
        order = (mixed, agree, disagree)
    else:
        order = (disagree,)
    for pick in order:
        found = pick()
        if found:
            return found
    if percent < LOW_BAND:
        return None
    if shared_artists:
        return {"kind": "artist", "artist": shared_artists[0], "text": text(ARTIST_TEXT, artist=shared_artists[0])}
    if shared_genres:
        return {"kind": "genre", "genre": shared_genres[0], "text": text(GENRE_TEXT, genre=shared_genres[0])}
    if shared:
        nearest = max(shared, key=lambda k: (min(a_records[k], b_records[k]), k))
        return record("shared", nearest, SHARED_TEXT)
    return None
