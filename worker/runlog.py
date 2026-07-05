"""
worker_run bookkeeping — one row per job execution so "did last night's run
happen, and what did it do?" is a single query instead of archaeology on
background-thread prints.
"""
import json

from sqlalchemy import text


def start(con, job: str, user_id: int | None = None) -> int:
    run_id = con.execute(text(
        "INSERT INTO workerrun (job, user_id, started_at, status)"
        " VALUES (:j, :u, NOW(), 'running') RETURNING id"),
        {"j": job, "u": user_id}).scalar()
    con.commit()
    return run_id


def finish(con, run_id: int, status: str, **detail):
    con.execute(text(
        "UPDATE workerrun SET finished_at = NOW(), status = :s,"
        " detail_json = :d WHERE id = :id"),
        {"s": status, "d": json.dumps(detail) if detail else None, "id": run_id})
    con.commit()
