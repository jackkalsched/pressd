"""
Is the Mac's nightly audio ingest alive? Exit 1 if not.

The ingest runs under launchd on a laptop, where GitHub cannot see it — and it
cannot run on a GitHub runner at all (yt-dlp is bot-blocked from datacenter
IPs; a self-hosted runner is out because this repository is public, and a
fork's pull request could run code on the machine holding .env). So this
check runs on a GitHub-hosted runner beside the nightly predictions and reads
the ingest's own bookkeeping row in `workerrun`. A red job there is the alarm
the ingest never had: it recorded 'ok' through five weeks of analyzing
nothing (see worker/audio_ingest.py).

Read-only. Needs only DATABASE_URL.

    python -m worker.audio_health
"""
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlalchemy import text
from backend.database import engine

# The job is scheduled nightly, but a closed laptop runs it on the next wake
# rather than on time. 36h tolerates one late night without letting a dead job
# go unnoticed past the second.
STALE_AFTER_H = 36

# The first run after an outage works through the whole backlog (766 tracks on
# 2026-09-29, ~15s each), so 'running' is normal for a few hours. Past this it is
# a run that died without recording anything.
RUNNING_TOO_LONG_H = 8


def main() -> int:
    with engine.connect() as con:
        row = con.execute(text("""
            SELECT id, status, detail_json, started_at, finished_at,
                   EXTRACT(EPOCH FROM (NOW() - started_at)) / 3600.0 AS age_h
            FROM workerrun WHERE job = 'audio_ingest'
            ORDER BY started_at DESC LIMIT 1
        """)).first()
        # A run frozen by a sleeping Mac sits at 'running' until the lid opens
        # and then finishes normally (Oct 6 2026: 00:30 → 23:13). That is only
        # an alarm once the ingest has also gone a full STALE_AFTER_H without a
        # success; before then it is a late night, which this check tolerates.
        last_ok_h = con.execute(text("""
            SELECT EXTRACT(EPOCH FROM (NOW() - MAX(finished_at))) / 3600.0
            FROM workerrun WHERE job = 'audio_ingest' AND status = 'ok'
        """)).scalar()
        last_ok_h = float(last_ok_h) if last_ok_h is not None else None
        pending = con.execute(text("""
            SELECT COUNT(DISTINCT s.track_id) FROM song s
            WHERE s.track_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM trackaudio ta
                WHERE ta.track_id = s.track_id AND ta.bpm IS NOT NULL)
        """)).scalar()

    problems = []
    if row is None:
        problems.append("audio_ingest has never recorded a run")
    else:
        detail = json.loads(row.detail_json) if row.detail_json else {}
        age = float(row.age_h)
        print(f"last audio_ingest run #{row.id}: status={row.status}, "
              f"started {age:.1f}h ago, finished={row.finished_at}")
        print(f"  detail: {detail}")
        if row.status == "error":
            problems.append(f"last run #{row.id} failed: {detail.get('error', 'no reason recorded')}")
        elif (row.status == "running" and age > RUNNING_TOO_LONG_H
              and not (last_ok_h is not None and last_ok_h <= STALE_AFTER_H)):
            problems.append(f"run #{row.id} has been 'running' for {age:.1f}h — it died "
                            f"without recording a result")
        if age > STALE_AFTER_H:
            problems.append(f"no run in {age:.0f}h — the Mac's launchd job has not fired "
                            f"(asleep, logged out, or uninstalled?)")
    print(f"tracks still waiting for audio: {pending}")

    for p in problems:
        # An annotation surfaces on the run's summary page, not only in the log.
        print(f"::error title=Audio ingest::{p}" if os.getenv("GITHUB_ACTIONS") else f"PROBLEM: {p}")
    if not problems:
        print("audio ingest healthy")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
