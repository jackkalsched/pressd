"""Taste overlap's nightly health check, and the flag for a re-checkpoint (spec §6.1).

The layered baseline ships (spec §3.7), but the factorization was starved when Jack
chose, most columns having one to three raters, and is expected to overtake it as
records gather raters. So every night both are scored on the checkpoint's own hold-out
(`taste_evaluate`'s HOLDOUT_FRAC and HOLDOUT_SEED, so the numbers read against the
checkpoint's 0.8556 / 0.8657 / 0.8462) with plain pooling as the floor, and the result
is one `workerrun` row (job `taste_health`) that Jack's morning brief reads. The keys of
its `detail_json` are that brief's contract: add to them, never rename one.

What each side is:

- **Baseline**: exactly what ships. The default column weights and `GAMMA`, with no γ
  search: the check measures the method, not a configuration chosen for tonight.
- **Factorization**: the checkpoint's configuration (rank 8, reg 5, bias reg 5,
  aggregates 0.25, final album score off, Claude's measures at 1), with γ chosen
  against the band as the checkpoint chose it, since nothing ships from it.

The spread and Jack's examples are the baseline's raw percents on everyone's full data,
unsmoothed, the way `taste_nightly` computes them before easing: the stored display
values lag by design and would hide a change in the method.

Milestones (1,000 / 2,500 / 5,000 / 10,000 users; 50 then 100 users sharing 50 songs
with someone) each fire once: a milestone is due the first night it is crossed and
absent from every earlier successful row. A night that errored records nothing, so the
next good night picks the milestone up. When one fires, the full checkpoint report
(`taste_evaluate.run`) rides in the row as `report_md`, where the morning brief reads
it; `--report PATH` also writes it to a file, for running by hand. The decision stays
Jack's; nothing switches.

It also reports the overlap stage itself (`overlap_stage`: the latest `taste_overlap`
row's status, when it finished and how many hours ago it started), since nothing else
reads that row and `nightly_predict` only prints when the stage fails. A stage that
errored, has sat at `running` for more than OVERLAP_RUNNING_H, or last ran more than
OVERLAP_STALE_H ago turns the job red (exit 1) after the row is written: the stored
percentages then stop moving while every surface goes on serving them. A stage that has
never run is reported as null and is not an alarm.

The report and the examples name users beside their percentages, and the repository is
public, so nothing per-user leaves through Actions: no artifact, no file, and the log
gets only the numbers. Names stay in the row.

Connections: one connection starts the row and loads everything in a read-only
transaction, and is closed before any fitting (the pooler allows 15 clients for the
whole project); a second, opened after the computing, finishes the row. With
`--dry-run` nothing is written, not even the row.

    python -m worker.taste_health [--report PATH] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable

from sqlalchemy import text

from backend.taste_baseline import baseline_similarity, raters_per_column, taste_vectors
from backend.taste_matrix import build_cells
from backend.taste_overlap import GAMMA, to_percent
from backend.taste_pairs import OFF_FIFTY
from worker.taste_evaluate import (
    MF_BASES, MF_WEIGHTS, TARGET_IQR, TARGET_P10, TARGET_P90, USER1, Data, bridge_matrix,
    build_cases, full_mf, holdout, load_from, mf_similarity, mf_users, pooling_mae, run, score, weights,
)
from worker.taste_nightly import percentiles

JOB = "taste_health"
SHARED_SONGS = 50
MILESTONES: dict[str, tuple[str, int]] = {     # name -> (what is counted, threshold)
    "users_1000": ("users", 1000),
    "users_2500": ("users", 2500),
    "users_5000": ("users", 5000),
    "users_10000": ("users", 10000),
    "sharing50_50": ("sharing_50", 50),
    "sharing50_100": ("sharing_50", 100),
}
RANK, REG, BIAS_REG = MF_BASES[0]
MF_CONFIG = {"weights": MF_WEIGHTS, "album_score": False, "rank": RANK, "reg": REG,
             "bias_reg": BIAS_REG, "m": 1.0}
SPREAD = (10, 25, 50, 75, 90)
EXAMPLES = {"highest": 3, "lowest": 3, "most_shared": 5}
OVERLAP_JOB = "taste_overlap"
OVERLAP_RUNNING_H = 6       # the stage takes seconds; running this long, it died unrecorded
OVERLAP_STALE_H = 36        # one late or skipped night tolerated, as audio_health does


# ---------------------------------------------------------------- pure helpers

def users_sharing(songs: Iterable[tuple[int, int]], min_shared: int = SHARED_SONGS) -> int:
    """Distinct users who share at least `min_shared` songs, by track, with at least one
    other user. A track scored on two editions is one song. Counted per track rather
    than per pair of users, so the cost follows how many people share each track."""
    raters: dict[int, set[int]] = defaultdict(set)
    for user, track in songs:
        raters[track].add(user)
    shared: Counter[tuple[int, int]] = Counter()
    for users in raters.values():
        us = sorted(users)
        for i, a in enumerate(us):
            for b in us[i + 1:]:
                shared[(a, b)] += 1
    return len({u for pair, n in shared.items() if n >= min_shared for u in pair})


def milestones_crossed(users: int, sharing_50: int) -> list[str]:
    counts = {"users": users, "sharing_50": sharing_50}
    return [name for name, (kind, at) in MILESTONES.items() if counts[kind] >= at]


def checkpoint_due(crossed: list[str], previous: Iterable[list[str] | None]) -> list[str]:
    """The milestones crossed now that no earlier successful row recorded."""
    seen = {m for row in previous if row for m in row}
    return [m for m in crossed if m not in seen]


def overlap_stage(row) -> dict | None:
    """The latest `taste_overlap` row as the brief reads it, from (status, finished_at,
    hours since it started); None when the stage has never run."""
    if row is None:
        return None
    status, finished_at, age_hours = row
    return {"status": status, "finished_at": finished_at.isoformat() if finished_at else None,
            "age_hours": round(float(age_hours), 1)}


def overlap_stage_problem(stage: dict | None) -> str | None:
    """Why the overlap stage should turn the job red, or None."""
    if stage is None:
        return None
    age = stage["age_hours"]
    if stage["status"] == "error":
        return "the nightly taste_overlap stage failed on its last run"
    if stage["status"] == "running" and age > OVERLAP_RUNNING_H:
        return f"the taste_overlap stage has been 'running' for {age:.1f}h: it died without recording a result"
    if age > OVERLAP_STALE_H:
        return f"the taste_overlap stage last ran {age:.0f}h ago"
    return None


# ---------------------------------------------------------------- the check

def accuracy(data: Data) -> dict:
    """Both approaches and pooling on the checkpoint's hold-out. The cases are built
    from the baseline's cells; a song cell's z doesn't depend on column weights, so
    they are the factorization's cases too."""
    train, held = holdout(data.rows)
    base_cells = build_cells(train)
    cases, _skipped = build_cases(train, held, base_cells)
    base = score("baseline", baseline_similarity(base_cells, taste_vectors(train, data.features)),
                 cases, gamma=GAMMA)
    mf_cells = build_cells(train, weights(MF_CONFIG["weights"], MF_CONFIG["album_score"], MF_CONFIG["m"]))
    mf = score("mf", mf_similarity(mf_cells, mf_users(mf_cells, MF_CONFIG), raters_per_column(mf_cells),
                                   bridge_matrix(mf_cells)), cases)
    return {"baseline": round(base.mae, 4), "factorization": round(mf.mae, 4),
            "pooling": round(pooling_mae(cases), 4), "held_out": len(cases)}


def spread(sims: dict, pct: dict) -> dict:
    with_ev = [pct[p] for p, (_r, ev) in sims.items() if ev > 0]
    ps = dict(zip((f"p{p}" for p in SPREAD), percentiles(with_ev, SPREAD)))
    in_band = bool(ps) and (ps["p10"] >= TARGET_P10 and ps["p90"] <= TARGET_P90
                            and ps["p75"] - ps["p25"] >= TARGET_IQR)
    return {**{k: round(v, 1) for k, v in ps.items()}, "in_band": in_band, "pairs": len(with_ev),
            "pairs_off_50": sum(abs(v - 50.0) >= OFF_FIFTY for v in pct.values())}


def user1_examples(data: Data, base_pct: dict, mf_pct: dict) -> dict:
    rows = data.rows
    tracks: dict[int, set[int]] = defaultdict(set)
    for s in rows.songs:
        tracks[s.user_id].add(s.track_id)
    records: dict[int, set[str]] = defaultdict(set)
    for a in rows.albums:
        if a.status == "rated" and a.subject_key:
            records[a.user_id].add(a.subject_key)

    def entry(pair) -> dict:
        other = pair[0] if pair[1] == USER1 else pair[1]
        return {"user_id": other, "name": data.usernames.get(other, f"user {other}"),
                "shared_songs": len(tracks[USER1] & tracks[other]),
                "shared_records": len(records[USER1] & records[other]),
                "baseline": round(base_pct[pair], 1), "factorization": round(mf_pct.get(pair, 50.0), 1)}

    mine = sorted((p for p in base_pct if USER1 in p), key=lambda p: (-base_pct[p], p))
    top = mine[:EXAMPLES["highest"]]
    bottom = mine[max(len(top), len(mine) - EXAMPLES["lowest"]):]
    other = lambda p: p[0] if p[1] == USER1 else p[1]   # noqa: E731
    most = sorted(mine, key=lambda p: (-len(tracks[USER1] & tracks[other(p)]), p))[:EXAMPLES["most_shared"]]
    return {"highest": [entry(p) for p in top], "lowest": [entry(p) for p in reversed(bottom)],
            "most_shared": [entry(p) for p in most]}


def attach_report(detail: dict, make_report: Callable[[], str]) -> dict:
    """Put the full checkpoint report in the row when a milestone is due tonight; a
    night with nothing due carries no `report_md` at all."""
    if detail["checkpoint_due"]:
        detail["report_md"] = make_report()
    return detail


def check(data: Data, previous: list[list[str] | None]) -> dict:
    rows = data.rows
    base_sims = baseline_similarity(build_cells(rows), taste_vectors(rows, data.features))
    base_pct = {p: to_percent(r, ev) for p, (r, ev) in base_sims.items()}
    _cells, _sims, mf_pct, _gamma, _bridges = full_mf(rows, MF_CONFIG)
    sharing = users_sharing((s.user_id, s.track_id) for s in rows.songs)
    crossed = milestones_crossed(len(data.usernames), sharing)
    return {
        "users": len(data.usernames), "users_sharing_50": sharing,
        "accuracy": accuracy(data), "spread": spread(base_sims, base_pct),
        "user1": user1_examples(data, base_pct, mf_pct),
        "milestones_crossed": crossed, "checkpoint_due": checkpoint_due(crossed, previous),
    }


def previous_milestones(con) -> list[list[str] | None]:
    out = []
    for (raw,) in con.execute(text(
            "SELECT detail_json FROM workerrun WHERE job = :j AND status = 'ok'"), {"j": JOB}):
        try:
            out.append(json.loads(raw).get("milestones_crossed") if raw else None)
        except (ValueError, AttributeError):
            out.append(None)
    return out


def latest_overlap_stage(con) -> dict | None:
    return overlap_stage(con.execute(text(
        "SELECT status, finished_at, EXTRACT(EPOCH FROM (NOW() - started_at)) / 3600.0"
        " FROM workerrun WHERE job = :j ORDER BY started_at DESC LIMIT 1"), {"j": OVERLAP_JOB}).first())


def run_health(engine, report_path: str | None = None, dry_run: bool = False) -> dict:
    """The check, logged as workerrun job `taste_health` unless `dry_run`. No
    connection is open while it computes. Raises after logging on failure."""
    from worker import runlog

    started = time.time()
    run_id = None
    try:
        with engine.connect() as con:
            if not dry_run:
                run_id = runlog.start(con, JOB)
            con.execute(text("SET TRANSACTION READ ONLY"))
            data = load_from(con)
            previous = previous_milestones(con)
            stage = latest_overlap_stage(con)
            con.rollback()
        detail = attach_report(check(data, previous), lambda: run(data, log=lambda *_: None))
        detail["overlap_stage"] = stage
        if report_path and "report_md" in detail:
            with open(report_path, "w") as f:
                f.write(detail["report_md"])
        detail["seconds"] = round(time.time() - started, 1)
        if run_id is not None:
            with engine.connect() as con:
                runlog.finish(con, run_id, "ok", **detail)
        return detail
    except Exception as e:
        if run_id is not None:
            try:
                with engine.connect() as con:
                    runlog.finish(con, run_id, "error", error=str(e))
            except Exception as e2:
                print(f"[taste_health] could not record the failure: {e2}")
        raise


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--report", help="also write the checkpoint report to this file when a milestone is due (local use)")
    ap.add_argument("--dry-run", action="store_true", help="read and compute; write no workerrun row")
    args = ap.parse_args()
    from backend.database import engine
    detail = run_health(engine, args.report, dry_run=args.dry_run)
    # The Actions log is public: numbers only, no names (the report names users too).
    hidden = {"report_md"} if args.dry_run else {"report_md", "user1"}
    print(json.dumps({k: v for k, v in detail.items() if k not in hidden}, indent=2))
    if "report_md" in detail:
        print(f"report_md: {len(detail['report_md'])} characters"
              + (f", also written to {args.report}" if args.report else ""))
    if detail["checkpoint_due"]:
        msg = f"checkpoint due: {', '.join(detail['checkpoint_due'])}"
        print(f"::warning title=Taste overlap::{msg}" if os.getenv("GITHUB_ACTIONS") else msg)
    problem = overlap_stage_problem(detail["overlap_stage"])
    if problem:
        print(f"::error title=Taste overlap::{problem}" if os.getenv("GITHUB_ACTIONS") else f"PROBLEM: {problem}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
