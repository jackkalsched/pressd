"""The nightly taste-overlap stage: every pair's percentage and reason, stored (spec §3.6).

The layered baseline (`backend/taste_baseline.py`) is what ships, Jack's choice at the
checkpoint (spec §3.7), so nothing here is fitted: the run builds every user's cells and
every album's feature vector, compares every pair, maps each through `to_percent`,
smooths it against last night's value, and attaches the reason line.

What is stored, and why:

- `tasteitem`: each album copy's standardized feature vector (`album:<album_id>`). The
  standardization is over the whole catalog, so the live path after a rating reads
  these rather than re-standardizing over the handful of albums it loads, which would
  put the caller on a different scale from everyone it is compared with. One more row,
  `raters`, holds every artist, cluster, genre and subgenre column's rater count, so
  the live path discounts those columns by the whole userbase, as tonight did, rather
  than by the few users it loads.
- `tasteuser`: each user's album-feature taste vector and the records behind it, so the
  live path compares a fresh rater against the stored vectors of the record's other
  raters. Every user with cells has a row — `[]` and 0 records when they have no
  vector — because its `updated_at` is how the live path tells whether someone rated
  since (`backend/taste_live.py`).
- `tasteoverlap`: pairs whose percent reads as anything but 50% (spec §8). A missing row
  is 50, with or without evidence: no-evidence pairs look exactly like any other 50%.

Smoothing (`taste_overlap.smooth`): a percent that moved only because the userbase did
eases toward tonight's value; one that moved because either user rated a record since
the stored value jumps there. "Rated since" is `album.rated_at`, which marks a copy's
first rating; song edits aren't timestamped, so re-scoring a rated record eases. A
missing row eases from 50, what it read as.

A row the live path writes after tonight's read is newer than anything computed here,
so it is kept: tonight's rows replace only rows stamped at or before the read.

Connections: one read transaction, closed before computing; one write transaction, in
bulk. The caller's connection is reused, so the stage never holds a second pooler slot
(the session pooler allows 15 clients for the whole project). All pairs was 3,081
on 2026-11-03 (79 users with a record) and grows with users²; candidate pairs (shared records or artists, friends) are
needed before a few thousand users (spec §3.7).

    python -m worker.taste_nightly [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import text

from backend.taste_baseline import baseline_similarity, load_album_features, taste_vectors
from backend.taste_live import RATERS_KEY, category_json
from backend.taste_matrix import Rows, build_cells, load_rows
from backend.taste_overlap import smooth, to_percent
from backend.taste_pairs import PairReasons, worth_storing

JOB = "taste_overlap"
PERCENTILES = (5, 10, 25, 50, 75, 90, 95)

Pair = tuple[int, int]


# ---------------------------------------------------------------- pure helpers

def displayed(new: float, stored: tuple[float, datetime] | None,
              last_run: datetime | None, latest_rating: datetime | None) -> float:
    """Tonight's shown percent for a pair. `stored` is its row (percent, updated_at),
    `last_run` the previous successful run, `latest_rating` the later of the two users'
    newest `rated_at`. A pair without a row read as 50 since the last run; before any
    run there is nothing to ease from."""
    since = stored[1] if stored else last_run
    previous = stored[0] if stored else (50.0 if last_run else None)
    rated_since = latest_rating is not None and since is not None and latest_rating > since
    return smooth(previous, new, rated_since)


def percentiles(values: list[float], ps=PERCENTILES) -> list[float]:
    """Linear interpolation between closest ranks, numpy's default, without numpy."""
    if not values:
        return []
    v = sorted(values)
    out = []
    for p in ps:
        x = (len(v) - 1) * p / 100
        lo = int(x)
        hi = min(lo + 1, len(v) - 1)
        out.append(v[lo] + (v[hi] - v[lo]) * (x - lo))
    return out


# ---------------------------------------------------------------- load

@dataclass
class Loaded:
    rows: Rows
    album_names: dict[int, str]
    features: dict[int, list[float]]
    stored: dict[Pair, tuple[float, datetime]]
    last_run: datetime | None
    latest_rating: dict[int, datetime]
    loaded_at: datetime


def load(con) -> Loaded:
    """Everything the run reads, in one transaction the caller ends."""
    loaded_at = con.execute(text("SELECT NOW()")).scalar()
    rows = load_rows(con)
    names = {r.id: r.album_name or "" for r in con.execute(text(
        "SELECT id, album_name FROM album WHERE status IN ('rated', 'listening')"))}
    features = load_album_features(con, rows, names)
    stored: dict[Pair, tuple[float, datetime]] = {}
    if con.execute(text("SELECT to_regclass('tasteoverlap')")).scalar():   # absent before first deploy
        for r in con.execute(text("SELECT user_id_a, user_id_b, percent, updated_at FROM tasteoverlap")):
            stored[(r.user_id_a, r.user_id_b)] = (r.percent, r.updated_at)
    last_run = con.execute(text(
        "SELECT MAX(started_at) FROM workerrun WHERE job = :j AND status = 'ok'"), {"j": JOB}).scalar()
    latest = {r.user_id: r.at for r in con.execute(text(
        "SELECT user_id, MAX(rated_at) AS at FROM album WHERE rated_at IS NOT NULL GROUP BY user_id"))}
    return Loaded(rows, names, features, stored, _aware(last_run), latest, loaded_at)


def _aware(t: datetime | None) -> datetime | None:
    """workerrun.started_at is a naive UTC timestamp; rated_at and updated_at carry a zone."""
    return t.replace(tzinfo=timezone.utc) if t is not None and t.tzinfo is None else t


# ---------------------------------------------------------------- compute

@dataclass
class Computed:
    items: list[tuple[str, str]] = field(default_factory=list)          # (column_key, vector_json)
    users: list[tuple[int, str, int]] = field(default_factory=list)     # (user_id, vector_json, records)
    overlaps: list[tuple[int, int, float, float, str | None]] = field(default_factory=list)
    raw: dict[Pair, tuple[float, float]] = field(default_factory=dict)  # (raw percent, evidence)
    shown: dict[Pair, float] = field(default_factory=dict)
    reasons: dict[str, int] = field(default_factory=dict)
    users_with_cells: int = 0


def _vec(v: list[float]) -> str:
    return json.dumps([round(x, 6) for x in v])


def compute(data: Loaded) -> Computed:
    rows = data.rows
    cells = build_cells(rows)
    vectors = taste_vectors(rows, data.features)
    sims = baseline_similarity(cells, vectors)
    reasons_for = PairReasons(rows, cells, data.album_names)

    out = Computed(users_with_cells=len(cells))
    out.items = [(f"album:{aid}", _vec(v)) for aid, v in sorted(data.features.items())]
    out.items.append((RATERS_KEY, category_json(cells)))
    # Every user with cells gets a row, `[]` when they have no vector: the row's
    # updated_at is what tells the live path whether they rated since (taste_live.py).
    out.users = [(uid, *((_vec(vectors[uid][0]), vectors[uid][1]) if uid in vectors else ("[]", 0)))
                 for uid in sorted(cells)]
    reasons: dict[str, int] = defaultdict(int)
    for (a, b), (r, ev) in sims.items():
        new = to_percent(r, ev)
        shown = displayed(new, data.stored.get((a, b)), data.last_run,
                          max((t for t in (data.latest_rating.get(a), data.latest_rating.get(b)) if t),
                              default=None))
        out.raw[(a, b)] = (new, ev)
        out.shown[(a, b)] = shown
        if not worth_storing(shown):
            continue
        reason = reasons_for(a, b, shown)
        reasons[reason["kind"] if reason else "none"] += 1
        out.overlaps.append((a, b, round(shown, 3), round(ev, 4), json.dumps(reason) if reason else None))
    out.reasons = dict(reasons)
    return out


# ---------------------------------------------------------------- write

def write(con, c: Computed, stamp: datetime) -> None:
    """Replace every row stamped at or before tonight's read, in one transaction. A
    row the live path wrote since is newer and is kept (ON CONFLICT DO NOTHING)."""
    from psycopg2.extras import execute_values

    for table, col in (("tasteitem", "fitted_at"), ("tasteuser", "updated_at"), ("tasteoverlap", "updated_at")):
        con.execute(text(f"DELETE FROM {table} WHERE {col} <= :t"), {"t": stamp})
    raw = con.connection.driver_connection
    with raw.cursor() as cur:
        execute_values(cur,
            "INSERT INTO tasteitem (column_key, vector_json, fitted_at) VALUES %s"
            " ON CONFLICT (column_key) DO NOTHING",
            [(k, v, stamp) for k, v in c.items])
        execute_values(cur,
            "INSERT INTO tasteuser (user_id, vector_json, records, updated_at) VALUES %s"
            " ON CONFLICT (user_id) DO NOTHING",
            [(u, v, n, stamp) for u, v, n in c.users])
        execute_values(cur,
            "INSERT INTO tasteoverlap (user_id_a, user_id_b, percent, evidence, reason_json, updated_at)"
            " VALUES %s ON CONFLICT (user_id_a, user_id_b) DO NOTHING",
            [(a, b, p, ev, reason, stamp) for a, b, p, ev, reason in c.overlaps])
    con.commit()


# ---------------------------------------------------------------- the run

def summary(c: Computed) -> dict:
    with_ev = [c.shown[p] for p, (_r, ev) in c.raw.items() if ev > 0]
    pct = lambda vs: {f"p{p}": round(x, 1) for p, x in zip(PERCENTILES, percentiles(vs))}   # noqa: E731
    return {
        "albums": sum(1 for k, _v in c.items if k.startswith("album:")), "users": c.users_with_cells, "taste_vectors": sum(1 for _u, _v, n in c.users if n), "pairs": len(c.raw),
        "pairs_with_evidence": len(with_ev), "pairs_stored": len(c.overlaps),
        "spread_with_evidence": pct(with_ev), "spread_all": pct(list(c.shown.values())),
        "reasons": c.reasons,
    }


def run_nightly(con, dry_run: bool = False) -> dict:
    """Compute and store every pair's overlap on the caller's connection, logged as
    workerrun job `taste_overlap`. With `dry_run`, read only and write nothing, not
    even the workerrun row. Returns the counts; raises after logging on failure, and
    leaves the connection usable either way."""
    from worker import runlog

    started = time.time()
    con.commit()        # end whatever the caller had open, so the read stands alone
    run_id = None if dry_run else runlog.start(con, JOB)
    try:
        if dry_run:
            con.execute(text("SET TRANSACTION READ ONLY"))
        data = load(con)
        con.rollback()
        computed = compute(data)
        if not dry_run:
            write(con, computed, data.loaded_at)
        detail = {**summary(computed), "seconds": round(time.time() - started, 1)}
        if run_id is not None:
            runlog.finish(con, run_id, "ok", **detail)
        return detail
    except Exception as e:
        con.rollback()
        if run_id is not None:
            try:
                runlog.finish(con, run_id, "error", error=str(e))
            except Exception:
                con.rollback()
        raise


def table(detail: dict) -> str:
    head = "| | Pairs | " + " | ".join(f"p{p}" for p in PERCENTILES) + " |"
    lines = [head, "|---|---|" + "---|" * len(PERCENTILES)]
    for label, key, n in (("All pairs", "spread_all", detail["pairs"]),
                          ("With evidence", "spread_with_evidence", detail["pairs_with_evidence"])):
        lines.append(f"| {label} | {n} | " + " | ".join(f"{v:.0f}" for v in detail[key].values()) + " |")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="read and compute; write nothing")
    args = ap.parse_args()
    from backend.database import engine
    with engine.connect() as con:
        detail = run_nightly(con, dry_run=args.dry_run)
    print(json.dumps({k: v for k, v in detail.items() if not k.startswith("spread")}, indent=2))
    print(table(detail))


if __name__ == "__main__":
    sys.exit(main())
