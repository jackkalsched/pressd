"""The checkpoint test for taste overlap (spec §3.5): matrix factorization against the
layered baseline, on held-out song scores, written up as a markdown report for Jack.

The test: hold out a fifth of each user's scored tracks, rebuild every cell from what
is left (aggregates included, or the test sees the answer), fit, and predict each
held-out score from the *other* users who scored that track, weighted by overlap. A
user at or below 50% gets no say, since 50% means "no evidence" and below it means
opposite taste, which a weighted mean of raw scores can't use. When nobody has a say
the prediction falls back to pooling: the user's own mean beats pooling on this data,
so falling back to it would reward the configuration that says least. The comparison
is plain pooling (every other rater counts the same) and the user's own mean (z = 0).
Everything is on each user's z scale, so a harsh and a generous scorer are compared
like for like.

Factorization users are scored from `fold_in` against the fitted items, the path the
web service runs, never from the fit's own user vectors.

The factorization grid is the configuration the first checkpoint chose (rank 8, reg 5,
bias reg 5, aggregates at 0.25, album score off) and the same at rank 4, each with
Claude's album measurements (`m` columns) at weight 0, 0.5 and 1: Jack's question at
the checkpoint was whether those columns help, and whether they move the best rank.
The baseline never reads `m` cells, so its grid runs without them.

Accuracy doesn't gate the feature; believability does (spec §3.5). So the report also
carries the full-data distributions against the §2 band, how much of the high end leans
on user 1 (who holds most of the scores), and example pairs Jack can check by eye. The
eye-test pairs, read under every configuration, are user ids from `--pairs` (`1:84,1:12`)
or, with none given, user 1's three highest, three lowest and the two sharing the most
songs under the chosen factorization. They are ids, not usernames, because the repository
is public: names are read from the database only into the local report.

Reads production, never writes: one read-only transaction loads everything, and it is
closed before any fitting starts (the pooler allows 15 clients for the whole project).
The report names users, so it is written wherever `--out` says and never committed.

    python -m worker.taste_evaluate --out PATH [--pairs 1:84,1:12]
"""
from __future__ import annotations

import argparse
import random
import statistics
import time
from collections import defaultdict
from dataclasses import dataclass, field
from itertools import product

import numpy as np

from backend.taste_matrix import COLUMN_WEIGHTS, Cells, Rows, SongRow, build_cells, load_rows
from backend.taste_overlap import BRIDGE_CAP, BRIDGE_WEIGHT, EVIDENCE_K, cosine, evidence, fold_in, to_percent
from backend.taste_baseline import baseline_similarity, load_album_features, raters_per_column, taste_vectors
from worker.taste_factorize import fit

HOLDOUT_FRAC = 0.2
HOLDOUT_SEED = 11
MF_BASES = (                    # (rank, reg, bias reg): the checkpoint's choice, then rank 4
    (8, 5.0, 5.0),
    (4, 5.0, 5.0),
)
MF_WEIGHTS = "aggregates 0.25"
MEASURE_WEIGHTS = (0.0, 0.5, 1.0)
TIE = 0.001                     # MAE gaps smaller than this are called a tie
AGGREGATES = ("a", "c", "g", "sg")
# The column weights the checkpoint ran against, frozen here: the shipped defaults in
# taste_matrix moved to the winning baseline's (aggregates 1.0, album score on), which
# would make "defaults" a copy of "aggregates 1.0" and change the grid.
CHECKPOINT_WEIGHTS = {**COLUMN_WEIGHTS, "a": 0.5, "c": 0.5, "g": 0.5, "sg": 0.5, "A": 0.0, "m": 0.5}
WEIGHTINGS: dict[str, dict[str, float]] = {
    "defaults": dict(CHECKPOINT_WEIGHTS),
    "aggregates 0.25": {**CHECKPOINT_WEIGHTS, **{t: 0.25 for t in AGGREGATES}},
    "aggregates 1.0": {**CHECKPOINT_WEIGHTS, **{t: 1.0 for t in AGGREGATES}},
}
ALBUM_SCORE_WEIGHT = 1.0    # the final album score's weight when its column is on
GAMMAS = tuple(round(0.3 + 0.1 * i, 1) for i in range(13))     # 0.3 … 1.5
TARGET_P10, TARGET_P90, TARGET_IQR = 25.0, 85.0, 15.0
PERCENTILES = (5, 10, 25, 50, 75, 90, 95)
USER1 = 1
HIGH = 80.0
EXAMPLE_SEED = 5
EYE_TEST = {"highest": 3, "lowest": 3, "most_shared": 2}   # user 1's pairs when --pairs is absent

Pair = tuple[int, int]
Sims = dict[Pair, tuple[float, float]]


def _pair(a: int, b: int) -> Pair:
    return (a, b) if a < b else (b, a)


def parse_pairs(spec: str) -> list[Pair]:
    """`1:84,1:12` -> [(1, 84), (1, 12)], in the order given."""
    out: list[Pair] = []
    for part in spec.split(","):
        if not part.strip():
            continue
        try:
            a, b = (int(x) for x in part.split(":"))
        except ValueError:
            raise argparse.ArgumentTypeError(f"not a pair of user ids: {part.strip()!r} (want 1:84)")
        if a == b:
            raise argparse.ArgumentTypeError(f"a pair needs two different users: {part.strip()!r}")
        out.append((a, b))
    return out


def eye_test_pairs(pct: dict[Pair, float], tracks_by: dict[int, set[int]], user: int = USER1) -> list[Pair]:
    """`user`'s pairs for the eye test when none were asked for: the highest, the lowest
    and those sharing the most songs, each as (user, other) and none twice."""
    other = lambda p: p[0] if p[1] == user else p[1]   # noqa: E731
    mine = sorted((p for p in pct if user in p), key=lambda p: (-pct[p], p))
    top = mine[:EYE_TEST["highest"]]
    bottom = list(reversed(mine[max(len(top), len(mine) - EYE_TEST["lowest"]):]))
    chosen = top + bottom
    most = [p for p in sorted(mine, key=lambda p: (-len(tracks_by.get(user, set()) & tracks_by.get(other(p), set())), p))
            if p not in chosen][:EYE_TEST["most_shared"]]
    return [(user, other(p)) for p in chosen + most]


# ---------------------------------------------------------------- hold-out

def holdout(rows: Rows, frac: float = HOLDOUT_FRAC, seed: int = HOLDOUT_SEED) -> tuple[Rows, list[SongRow]]:
    """Hold out `frac` of each user's distinct scored tracks. A track is held out whole:
    a user who scored it on two editions loses both, or their own training cell for it
    would carry the answer into the overlap. Albums stay, so a record whose every song
    was held out keeps its factors."""
    rng = random.Random(seed)
    tracks: dict[int, set[int]] = defaultdict(set)
    for s in rows.songs:
        tracks[s.user_id].add(s.track_id)
    held: set[tuple[int, int]] = set()
    for user in sorted(tracks):
        mine = sorted(tracks[user])
        held.update((user, t) for t in rng.sample(mine, round(frac * len(mine))))
    train = [s for s in rows.songs if (s.user_id, s.track_id) not in held]
    out = [s for s in rows.songs if (s.user_id, s.track_id) in held]
    return Rows(songs=train, albums=rows.albums, clusters=rows.clusters, measures=rows.measures), out


@dataclass
class Case:
    user: int
    target: float                       # the held-out score on the user's training z scale
    others: list[tuple[int, float]]     # (other user, their training z on the track)


def build_cases(train: Rows, held: list[SongRow], cells: dict[int, Cells]) -> tuple[list[Case], int]:
    """One case per held-out (user, track); also the number skipped because no other
    training user scored the track."""
    by_track: dict[int, list[float]] = defaultdict(list)
    for s in train.songs:
        by_track[(s.user_id, s.track_id)].append(s.score)
    scale: dict[int, tuple[float, float]] = {}
    per_user: dict[int, list[float]] = defaultdict(list)
    for (user, _t), v in by_track.items():
        per_user[user].append(statistics.fmean(v))
    for user, v in per_user.items():
        scale[user] = (statistics.fmean(v), statistics.pstdev(v))

    held_scores: dict[tuple[int, int], list[float]] = defaultdict(list)
    for s in held:
        held_scores[(s.user_id, s.track_id)].append(s.score)
    raters: dict[int, list[int]] = defaultdict(list)
    for user, c in cells.items():
        for key in c:
            if key.startswith("s:"):
                raters[int(key[2:])].append(user)

    cases, skipped = [], 0
    for (user, track), v in sorted(held_scores.items()):
        others = [(o, cells[o][f"s:{track}"][0]) for o in raters.get(track, []) if o != user]
        if not others or user not in scale:
            skipped += 1
            continue
        mean, sd = scale[user]
        cases.append(Case(user, (statistics.fmean(v) - mean) / sd if sd > 0 else 0.0, others))
    return cases, skipped


def predict(user: int, others: list[tuple[int, float]], pct: dict[Pair, float]) -> float | None:
    """Overlap-weighted mean of the other raters' z, weight max(percent − 50, 0). None
    when nobody has a say."""
    num = den = 0.0
    for other, z in others:
        w = max(pct.get(_pair(user, other), 50.0) - 50.0, 0.0)
        num += w * z
        den += w
    return num / den if den > 0 else None


# ---------------------------------------------------------------- the curve

def _spread(values: list[float]) -> tuple[float, float, float]:
    p10, p25, p75, p90 = np.percentile(values, [10, 25, 75, 90])
    return float(p10), float(p90), float(p75 - p25)


def _shortfall(values: list[float]) -> float:
    p10, p90, iqr = _spread(values)
    return max(0.0, TARGET_P10 - p10) + max(0.0, p90 - TARGET_P90) + max(0.0, TARGET_IQR - iqr)


def choose_gamma(pairs: list[tuple[float, float]], k: float = EVIDENCE_K) -> tuple[float, bool]:
    """The γ whose pairs-with-evidence distribution meets the §2 band (10th pct ≥ 25,
    90th ≤ 85, IQR ≥ 15). Of several that do, the one nearest 1, the least bending of
    the model's own output; of none, the one that misses by the fewest points."""
    if not pairs:
        return 1.0, False
    scored = [(_shortfall([to_percent(r, ev, k, g) for r, ev in pairs]), g) for g in GAMMAS]
    ok = [g for s, g in scored if s == 0.0]
    if ok:
        return min(ok, key=lambda g: (abs(g - 1.0), g)), True
    return min(scored)[1], False


# ---------------------------------------------------------------- similarities

def bridge_matrix(cells: dict[int, Cells]) -> tuple[list[int], np.ndarray, np.ndarray]:
    """(uids, shares, bridges): shares[i, j] says users i and j have a column in common;
    bridges[i, j] counts third users who share a column with both."""
    uids = sorted(cells)
    n = len(uids)
    shares = np.zeros((n, n), dtype=np.int64)
    keys = [set(cells[u]) for u in uids]
    for i in range(n):
        for j in range(i + 1, n):
            if not keys[i].isdisjoint(keys[j]):
                shares[i, j] = shares[j, i] = 1
    return uids, shares, shares @ shares


def mf_similarity(cells: dict[int, Cells], users: dict[int, list[float]],
                  raters: dict[str, int], bridges: tuple[list[int], np.ndarray, np.ndarray]) -> Sims:
    uids, _shares, b = bridges
    out: Sims = {}
    for i, a in enumerate(uids):
        for j in range(i + 1, len(uids)):
            c = uids[j]
            r = cosine(users.get(a, []), users.get(c, []))
            out[(a, c)] = (r, evidence(cells[a], cells[c], raters, int(b[i, j])))
    return out


def mf_users(cells: dict[int, Cells], cfg: dict) -> dict[int, list[float]]:
    """Fit the items, then place every user by `fold_in`, as the web service will."""
    model = fit(cells, rank=cfg["rank"], reg=cfg["reg"], bias_reg=cfg["bias_reg"])
    return {u: fold_in(c, model.items, reg=cfg["reg"]) for u, c in cells.items()}


def user1_dependent(ev: float, bridges: int, through_user1: bool) -> bool:
    """True when the pair's evidence reaches EVIDENCE_K only because user 1 is one of
    its bridges: without that one bridge it falls below."""
    if not through_user1 or ev < EVIDENCE_K:
        return False
    lost = BRIDGE_WEIGHT * (min(bridges, BRIDGE_CAP) - min(bridges - 1, BRIDGE_CAP))
    return ev - lost < EVIDENCE_K


@dataclass
class Scored:
    label: str
    gamma: float
    met: bool
    mae: float
    fallbacks: int
    pct: dict[Pair, float] = field(repr=False)
    said_mae: float = float("nan")      # on the cases where someone had a say …
    said_pooled: float = float("nan")   # … and pooling on those same cases


def score(label: str, sims: Sims, cases: list[Case], gamma: float | None = None) -> Scored:
    """MAE over the cases. γ is chosen against the band unless `gamma` fixes it, as the
    nightly health check does for the shipped baseline."""
    if gamma is None:
        gamma, met = choose_gamma([v for v in sims.values() if v[1] > 0])
    else:
        vals = [to_percent(r, ev, EVIDENCE_K, gamma) for r, ev in sims.values() if ev > 0]
        met = bool(vals) and _shortfall(vals) == 0.0
    pct = {p: to_percent(r, ev, EVIDENCE_K, gamma) for p, (r, ev) in sims.items()}
    errs, said, said_pooled, fallbacks = [], [], [], 0
    for c in cases:
        guess = predict(c.user, c.others, pct)
        if guess is None:
            # Nobody has a say: fall back to pooling, so an approach that leaves
            # everyone at or below 50% scores like pooling, not like silence.
            fallbacks += 1
            guess = _pooled(c)
        else:
            said.append(abs(guess - c.target))
            said_pooled.append(abs(_pooled(c) - c.target))
        errs.append(abs(guess - c.target))
    mean = lambda v: statistics.fmean(v) if v else float("nan")   # noqa: E731
    return Scored(label, gamma, met, mean(errs), fallbacks, pct, mean(said), mean(said_pooled))


def _pooled(c: Case) -> float:
    return statistics.fmean(z for _, z in c.others)


def pooling_mae(cases: list[Case]) -> float:
    """The floor: every other rater counts the same."""
    return statistics.fmean(abs(_pooled(c) - c.target) for c in cases)


def weights(name: str, album_score: bool, m: float = 0.0) -> dict[str, float]:
    return {**WEIGHTINGS[name], "A": ALBUM_SCORE_WEIGHT if album_score else 0.0, "m": m}


def mf_configs() -> list[dict]:
    return [{"weights": MF_WEIGHTS, "album_score": False, "rank": rank, "reg": reg, "bias_reg": bias_reg, "m": m}
            for (rank, reg, bias_reg), m in product(MF_BASES, MEASURE_WEIGHTS)]


def full_mf(rows: Rows, cfg: dict) -> tuple[Cells, Sims, dict[Pair, float], tuple[float, bool], tuple]:
    """A factorization configuration fitted on everyone's full data: its cells,
    similarities, percents, (γ, band met) and bridge matrix."""
    cells = build_cells(rows, weights(cfg["weights"], cfg["album_score"], cfg["m"]))
    bridges = bridge_matrix(cells)
    sims = mf_similarity(cells, mf_users(cells, cfg), raters_per_column(cells), bridges)
    gamma, met = choose_gamma([v for v in sims.values() if v[1] > 0])
    pct = {p: to_percent(r, ev, EVIDENCE_K, gamma) for p, (r, ev) in sims.items()}
    return cells, sims, pct, (gamma, met), bridges


# ---------------------------------------------------------------- loading

@dataclass
class Data:
    rows: Rows
    album_names: dict[int, str]
    features: dict[int, list[float]]
    usernames: dict[int, str]


def load_from(con) -> Data:
    """Everything the test reads, inside the caller's transaction (the health check adds
    its own reads to the same one)."""
    from sqlalchemy import text

    rows = load_rows(con)
    names = {r.id: r.album_name or "" for r in con.execute(text(
        "SELECT id, album_name FROM album WHERE status IN ('rated', 'listening')"))}
    features = load_album_features(con, rows, names)
    users = {r.id: r.name or f"user {r.id}" for r in con.execute(text("SELECT id, name FROM pressuser"))}
    return Data(rows, names, features, users)


def load() -> Data:
    from sqlalchemy import text

    from backend.database import engine

    with engine.connect() as con:
        con.execute(text("SET TRANSACTION READ ONLY"))
        data = load_from(con)
        con.rollback()
    return data


# ---------------------------------------------------------------- the run

def run(data: Data, log=print, pairs: list[Pair] | None = None) -> str:
    """The report. `pairs` are the eye-test pairs by user id; None derives them from
    user 1's pairs (`eye_test_pairs`)."""
    started = time.time()
    rows = data.rows
    train, held = holdout(rows)
    vectors_train = taste_vectors(train, data.features)

    mf_results: list[tuple[dict, Scored]] = []
    base_results: list[tuple[dict, Scored]] = []
    cases: list[Case] = []
    skipped = 0
    for wname, album_score in product(WEIGHTINGS, (False, True)):
        cells = build_cells(train, weights(wname, album_score))
        if not cases:
            cases, skipped = build_cases(train, held, cells)
        cfg = {"weights": wname, "album_score": album_score}
        base_results.append((cfg, score("baseline", baseline_similarity(cells, vectors_train), cases)))
    by_m: dict[float, tuple[dict[int, Cells], dict, tuple]] = {}
    for mcfg in mf_configs():
        if mcfg["m"] not in by_m:
            cells = build_cells(train, weights(mcfg["weights"], mcfg["album_score"], mcfg["m"]))
            by_m[mcfg["m"]] = (cells, raters_per_column(cells), bridge_matrix(cells))
        cells, raters, bridges = by_m[mcfg["m"]]
        s = score("mf", mf_similarity(cells, mf_users(cells, mcfg), raters, bridges), cases)
        mf_results.append((mcfg, s))
        log(f"{_cfg_text(mcfg)}: MAE {s.mae:.4f} γ {s.gamma}")
    pooled = pooling_mae(cases)
    own_mean = statistics.fmean(abs(c.target) for c in cases)
    holdout_secs = time.time() - started

    mf_cfg, mf_best = min(mf_results, key=lambda x: x[1].mae)
    base_cfg, base_best = min(base_results, key=lambda x: x[1].mae)

    # The shipped numbers: every factorization configuration fitted on everyone's full
    # data (the example pairs are read under each), and the baseline's choice.
    full = {_key(cfg): full_mf(rows, cfg) for cfg, _ in mf_results}
    cells_mf, mf_sims, mf_pct, (mf_gamma, mf_met), bridges_mf = full[_key(mf_cfg)]
    alt_cfg = None
    if mf_cfg["m"] == 0.0:
        alt_cfg = next(c for c, _ in mf_results if c["m"] == 0.5 and _key({**c, "m": 0.0}) == _key(mf_cfg))
    cells_base = build_cells(rows, weights(base_cfg["weights"], base_cfg["album_score"]))
    base_sims = baseline_similarity(cells_base, taste_vectors(rows, data.features))
    base_gamma, base_met = choose_gamma([v for v in base_sims.values() if v[1] > 0])
    base_pct = {p: to_percent(r, ev, EVIDENCE_K, base_gamma) for p, (r, ev) in base_sims.items()}

    return _report(
        data=data, cells=cells_mf, n_held=len(held), cases=cases, skipped=skipped,
        pooled=pooled, own_mean=own_mean, mf_results=mf_results, base_results=base_results,
        mf_cfg=mf_cfg, mf_best=mf_best, base_cfg=base_cfg, base_best=base_best,
        mf_sims=mf_sims, base_sims=base_sims, mf_pct=mf_pct, base_pct=base_pct,
        mf_gamma=(mf_gamma, mf_met), base_gamma=(base_gamma, base_met),
        bridges=bridges_mf, holdout_secs=holdout_secs, total_secs=time.time() - started,
        full=full, alt_cfg=alt_cfg, eye_pairs=pairs,
    )


def _key(cfg: dict) -> tuple:
    return tuple(sorted(cfg.items()))


# ---------------------------------------------------------------- the report

def _cfg_text(cfg: dict) -> str:
    parts = ([f"rank {cfg['rank']}", f"reg {cfg['reg']:g}", f"bias reg {cfg['bias_reg']:g}"]
             if "rank" in cfg else [])
    parts += [f"column weights {cfg['weights']}", f"final album score {'on' if cfg['album_score'] else 'off'}"]
    if "m" in cfg:
        parts.append(f"measures {cfg['m']:g}")
    return ", ".join(parts)


def _pct_row(label: str, values: list[float]) -> str:
    if not values:
        return f"| {label} | 0 | " + " | ".join("–" for _ in PERCENTILES) + " |"
    ps = np.percentile(values, PERCENTILES)
    return f"| {label} | {len(values)} | " + " | ".join(f"{p:.0f}" for p in ps) + " |"


def _report(*, data: Data, cells, n_held, cases, skipped, pooled, own_mean, mf_results,
            base_results, mf_cfg, mf_best, base_cfg, base_best, mf_sims, base_sims, mf_pct,
            base_pct, mf_gamma, base_gamma, bridges, holdout_secs, total_secs, full, alt_cfg,
            eye_pairs=None) -> str:
    rows = data.rows
    name = lambda u: data.usernames.get(u, f"user {u}")   # noqa: E731
    pairs = sorted(mf_pct)
    tracks_by: dict[int, set[int]] = defaultdict(set)
    for s in rows.songs:
        tracks_by[s.user_id].add(s.track_id)
    eye = list(eye_pairs) if eye_pairs else eye_test_pairs(mf_pct, tracks_by)
    alt = full[_key(alt_cfg)] if alt_cfg else None
    alt_pct = alt[2] if alt else None
    alt_label = f"Factorization, measures {alt_cfg['m']:g}" if alt_cfg else ""
    out: list[str] = []
    w = out.append

    w("# Taste overlap: the checkpoint report\n")
    w(f"Read-only against production. {len(cells)} users with a rated or listening record, "
      f"{len(pairs)} pairs, {len(rows.songs)} song scores, "
      f"{len({k for c in cells.values() for k in c})} matrix columns. "
      f"Grid of {len(mf_results)} factorization and {len(base_results)} baseline configurations on "
      f"every user (no subsample), {holdout_secs / 60:.1f} min; {total_secs / 60:.1f} min in all.\n")

    w("## 1. Accuracy on held-out song scores\n")
    w(f"{HOLDOUT_FRAC:.0%} of each user's scored tracks held out (seed {HOLDOUT_SEED}), every cell "
      f"rebuilt from the rest: {n_held} song scores held out, {len(cases)} predicted, "
      f"{skipped} skipped because no other user scored the track. "
      "Mean absolute error on the user's own z scale; lower is better.\n")
    w("| Prediction | MAE (z) | Cases with nobody above 50% (predicted by pooling) |")
    w("|---|---|---|")
    w(f"| Matrix factorization, overlap-weighted | {mf_best.mae:.4f} | {mf_best.fallbacks} |")
    w(f"| Layered baseline, overlap-weighted | {base_best.mae:.4f} | {base_best.fallbacks} |")
    w(f"| Pooling, every other rater equal | {pooled:.4f} | – |")
    w(f"| The user's own mean (z = 0), for reference | {own_mean:.4f} | – |\n")
    best = min((mf_best.mae, "matrix factorization"), (base_best.mae, "the layered baseline"),
               (pooled, "plain pooling"))
    w(f"Lowest error of the three: {best[1]}. A case where nobody is above 50% is predicted by "
      "pooling, so silence scores exactly like pooling and configurations are chosen on this MAE. "
      "The user's own mean beats pooling on this data, a sign of how little other people's scores "
      "on a track tell you about yours. On only the cases where each approach had a say:\n")
    w("| | Cases with a say | Its MAE | Pooling's MAE on the same cases |")
    w("|---|---|---|---|")
    for label, s in (("Matrix factorization", mf_best), ("Layered baseline", base_best)):
        w(f"| {label} | {len(cases) - s.fallbacks} | {s.said_mae:.4f} | {s.said_pooled:.4f} |")
    w("")

    w("## 2. The chosen configuration\n")
    w(f"- **Factorization:** {_cfg_text(mf_cfg)}; γ {mf_best.gamma} on the hold-out "
      f"({'meets' if mf_best.met else 'misses'} the band), γ {mf_gamma[0]} on the full data "
      f"({'meets' if mf_gamma[1] else 'misses'} the band).")
    w(f"- **Baseline:** {_cfg_text(base_cfg)}; γ {base_best.gamma} on the hold-out "
      f"({'meets' if base_best.met else 'misses'}), γ {base_gamma[0]} on the full data "
      f"({'meets' if base_gamma[1] else 'misses'}).")
    for label, results, cfg in (("factorization", mf_results, mf_cfg), ("baseline", base_results, base_cfg)):
        same = [s.mae for c, s in results
                if all(c[k] == cfg[k] for k in cfg if k != "album_score") and c["album_score"] != cfg["album_score"]]
        if not same:
            continue
        gap = min(same) - min(s.mae for c, s in results if c == cfg)
        other = "off" if cfg["album_score"] else "on"
        verdict = (f"a tie: {other} is {gap:.4f} behind, under {TIE:g}" if gap < TIE
                   else f"{other} is {gap:.4f} behind")
        w(f"- Final album score for the {label}: {verdict}.")
    w("- The baseline's album-feature layer reads `albumfactors`, Claude's theme axes and "
      "distinctness, beside the audio means; Jack kept it at the first checkpoint (spec §3.7).")
    w(f"- Chosen by lowest MAE. γ per configuration from {GAMMAS[0]}–{GAMMAS[-1]}: the value nearest "
      f"1 whose pairs with evidence have 10th pct ≥ {TARGET_P10:.0f}, 90th ≤ {TARGET_P90:.0f} and "
      f"IQR ≥ {TARGET_IQR:.0f}, or the nearest miss. EVIDENCE_K {EVIDENCE_K:g} and the other "
      "constants in `backend/taste_overlap.py` are unchanged.")
    m_cells = cells if mf_cfg["m"] > 0 else (alt[0] if alt else {})
    w(f"- Claude's measurements: {len(rows.measures)} rated or listening records carry a complete "
      f"`albumfactors` row; {sum(any(k.startswith('m:') for k in c) for c in m_cells.values())} users "
      "have `m` cells.")
    for other in sorted({c["m"] for c, _ in mf_results} - {mf_cfg["m"]}):
        rival = [s.mae for c, s in mf_results if c["m"] == other and _key({**c, "m": mf_cfg["m"]}) == _key(mf_cfg)]
        if rival:
            gap = rival[0] - mf_best.mae
            w(f"- Measures {other:g} at the same rank: {gap:.4f} behind"
              + (f", a tie (under {TIE:g})." if gap < TIE else "."))
    if alt_cfg:
        w(f"- Measures at weight 0 win, so sections 3–5 also show {_cfg_text(alt_cfg)} beside it.")
    w("- With the final album score on, the held-out songs still sit inside each user's stored "
      "album score, so that column slightly favours itself in this test.\n")
    w(f"Factorization configurations, all with column weights {MF_WEIGHTS} and the final album "
      "score off, best first. MAE and said-only MAE are on the hold-out; each example pair is its "
      "percent on the full data, at that configuration's own full-data γ"
      + ("." if eye_pairs else "; with no `--pairs`, the pairs are user 1's three highest, three "
         "lowest and the two sharing the most songs under the chosen configuration.") + "\n")
    w("| Rank | Measures | γ (hold-out / full) | MAE | Said-only MAE | Fallbacks | "
      + " | ".join(f"{name(a)} · {name(b)}" for a, b in eye) + " |")
    w("|---|---|---|---|---|---|" + "---|" * len(eye))
    for cfg, s in sorted(mf_results, key=lambda x: x[1].mae):
        _c, _s, pct, (g, _met), _b = full[_key(cfg)]
        cols = [f"{pct[_pair(a, b)]:.0f}%" if _pair(a, b) in pct else "–" for a, b in eye]
        w(f"| {cfg['rank']} | {cfg['m']:g} | {s.gamma} / {g} | {s.mae:.4f} | {s.said_mae:.4f} "
          f"| {s.fallbacks} | " + " | ".join(cols) + " |")
    missing = sorted({u for p in eye for u in p if u not in data.usernames})
    if missing:
        w(f"\nNo user with id: {', '.join(map(str, missing))}.")
    w("\nBaseline configurations:\n")
    w("| Column weights | Album score | γ | Band met | MAE |")
    w("|---|---|---|---|---|")
    for cfg, s in sorted(base_results, key=lambda x: x[1].mae):
        w(f"| {cfg['weights']} | {'on' if cfg['album_score'] else 'off'} | {s.gamma} "
          f"| {'yes' if s.met else 'no'} | {s.mae:.4f} |")

    w("\n## 3. Distributions on the full data\n")
    w("Percent per pair from the chosen configurations fitted on everyone. "
      "\"With evidence\" is a pair whose evidence is above zero.\n")
    w("| | Pairs | " + " | ".join(f"p{p}" for p in PERCENTILES) + " |")
    w("|---|---|" + "---|" * len(PERCENTILES))
    w(_pct_row("Factorization, all pairs", [mf_pct[p] for p in pairs]))
    w(_pct_row("Factorization, with evidence", [mf_pct[p] for p in pairs if mf_sims[p][1] > 0]))
    if alt:
        w(_pct_row(f"{alt_label}, all pairs", [alt_pct[p] for p in pairs]))
        w(_pct_row(f"{alt_label}, with evidence", [alt_pct[p] for p in pairs if alt[1][p][1] > 0]))
    w(_pct_row("Baseline, all pairs", [base_pct[p] for p in pairs]))
    w(_pct_row("Baseline, with evidence", [base_pct[p] for p in pairs if base_sims[p][1] > 0]))
    direct = [p for p in pairs if any(k[:2] in ("s:", "f:") for k in cells[p[0]].keys() & cells[p[1]].keys())]
    w(_pct_row("Factorization, sharing a song or record", [mf_pct[p] for p in direct]))
    if alt:
        w(_pct_row(f"{alt_label}, sharing a song or record", [alt_pct[p] for p in direct]))
    w(_pct_row("Baseline, sharing a song or record", [base_pct[p] for p in direct]))
    w("")

    w("## 4. How much of the high end leans on user 1\n")
    uids, shares, b = bridges
    idx = {u: i for i, u in enumerate(uids)}
    u1 = idx.get(USER1)
    high = [p for p in pairs if mf_pct[p] > HIGH]
    with_u1 = [p for p in high if USER1 in p]
    no_column = [p for p in high if not shares[idx[p[0]], idx[p[1]]]]
    leaning = [p for p in high if USER1 not in p and u1 is not None and user1_dependent(
        mf_sims[p][1], int(b[idx[p[0]], idx[p[1]]]),
        bool(shares[idx[p[0]], u1] and shares[idx[p[1]], u1]))]
    thin = [p for p in high if mf_sims[p][1] < EVIDENCE_K]
    w(f"Factorization: **{len(high)}** pairs above {HIGH:.0f}%"
      + (f" ({len(high) / len(pairs):.1%} of all pairs)." if pairs else "."))
    w(f"- including user 1 ({name(USER1)}): {len(with_u1)}")
    w(f"- sharing no column at all: {len(no_column)}")
    w(f"- whose evidence falls below EVIDENCE_K ({EVIDENCE_K:g}) with user 1 removed from the bridge "
      f"count: **{len(leaning)}**" + (f" ({len(leaning) / len(high):.0%} of the high pairs)" if high else ""))
    w(f"- whose evidence is below EVIDENCE_K even with user 1: {len(thin)}\n")
    if alt:
        ahigh = [p for p in pairs if alt_pct[p] > HIGH]
        w(f"{alt_label}: {len(ahigh)} pairs above {HIGH:.0f}%, {sum(USER1 in p for p in ahigh)} "
          "including user 1.\n")
    bhigh = [p for p in pairs if base_pct[p] > HIGH]
    w(f"Baseline: {len(bhigh)} pairs above {HIGH:.0f}%, {sum(USER1 in p for p in bhigh)} including "
      f"user 1, {sum(not shares[idx[p[0]], idx[p[1]]] for p in bhigh)} sharing no column. Its "
      "evidence has no bridge term, so none of it can come through user 1 as a bridge.\n")

    w("## 5. Example pairs\n")
    ranked = sorted(pairs, key=lambda p: (-mf_pct[p], p))
    top, bottom = ranked[:3], ranked[-3:]
    rest = [p for p in ranked[3:-3]]
    picks = random.Random(EXAMPLE_SEED).sample(rest, min(6, len(rest)))
    rated_by: dict[int, dict[str, str]] = defaultdict(dict)
    for a in rows.albums:
        if a.status == "rated":
            rated_by[a.user_id][a.subject_key] = data.album_names.get(a.album_id, a.subject_key)
    most = sorted(pairs, key=lambda p: (-len(tracks_by[p[0]] & tracks_by[p[1]]), p))[:5]
    w("The three highest and three lowest by factorization, six at random from every pair, then "
      "the five pairs sharing the most songs, where the direct evidence is strongest.\n")
    alt_head = f" {alt_label} |" if alt else ""
    w("| | Users | Shared rated records | Shared songs | Factorization |" + alt_head + " Baseline |")
    w("|---|---|---|---|---|---|" + ("---|" if alt else ""))
    for tag, group in (("highest", top), ("lowest", bottom), ("random", sorted(picks, key=lambda p: -mf_pct[p])),
                       ("most shared", most)):
        for a, c in group:
            shared = sorted(rated_by[a].keys() & rated_by[c].keys())
            titles = ", ".join(rated_by[a][k] for k in shared[:3]) + (f" +{len(shared) - 3}" if len(shared) > 3 else "")
            w(f"| {tag} | {name(a)} · {name(c)} | {len(shared)}{': ' + titles if shared else ''} "
              f"| {len(tracks_by[a] & tracks_by[c])} | {mf_pct[(a, c)]:.0f}% |"
              + (f" {alt_pct[(a, c)]:.0f}% |" if alt else "") + f" {base_pct[(a, c)]:.0f}% |")
    w("")
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", help="where to write the markdown report (default: stdout)")
    ap.add_argument("--pairs", type=parse_pairs, default=None,
                    help="eye-test pairs by user id, e.g. 1:84,1:12 (default: user 1's highest, "
                         "lowest and most-shared pairs)")
    args = ap.parse_args()
    report = run(load(), pairs=args.pairs)
    if args.out:
        with open(args.out, "w") as f:
            f.write(report)
        print(f"wrote {args.out}")
    else:
        print(report)


if __name__ == "__main__":
    main()
