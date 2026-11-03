from datetime import datetime

from worker.taste_health import (
    MILESTONES, OVERLAP_RUNNING_H, OVERLAP_STALE_H, attach_report, checkpoint_due, milestones_crossed,
    overlap_stage, overlap_stage_problem, users_sharing,
)


def test_no_milestone_below_every_threshold():
    assert milestones_crossed(users=80, sharing_50=3) == []


def test_crossed_milestones_accumulate():
    assert milestones_crossed(users=2600, sharing_50=60) == ["users_1000", "users_2500", "sharing50_50"]
    assert milestones_crossed(users=10000, sharing_50=100) == list(MILESTONES)


def test_milestone_in_a_previous_row_is_not_due_again():
    crossed = milestones_crossed(users=1200, sharing_50=10)
    assert checkpoint_due(crossed, [["users_1000"]]) == []
    assert checkpoint_due(crossed, [[], None]) == ["users_1000"]


def test_crossing_two_at_once_makes_both_due():
    crossed = milestones_crossed(users=2500, sharing_50=50)
    assert checkpoint_due(crossed, [["users_1000"]]) == ["users_2500", "sharing50_50"]


def test_users_sharing_counts_fifty_shared_tracks_not_forty_nine():
    songs = [(1, t) for t in range(60)]
    songs += [(2, t) for t in range(50)]                 # shares 50 with user 1
    songs += [(3, t) for t in range(100, 149)] + [(4, t) for t in range(100, 149)]   # 3 and 4 share 49
    assert users_sharing(songs, 50) == 2
    assert users_sharing(songs, 49) == 4


def test_users_sharing_counts_each_track_once_per_user():
    # Two editions of one record: the same track scored twice by user 1 is one song.
    songs = [(1, t) for t in range(50)] * 2 + [(2, t) for t in range(49)]
    assert users_sharing(songs, 50) == 0


def test_a_due_milestone_puts_the_report_in_the_row():
    detail = attach_report({"checkpoint_due": ["users_1000"]}, lambda: "# report")
    assert detail["report_md"] == "# report"


def test_nothing_due_carries_no_report():
    called = []
    detail = attach_report({"checkpoint_due": []}, lambda: called.append(1) or "# report")
    assert "report_md" not in detail and not called


# ---------------------------------------------------------------- the overlap stage

def test_overlap_stage_reads_the_latest_row():
    assert overlap_stage(("ok", datetime(2026, 11, 3, 10, 30), 3.04)) == {
        "status": "ok", "finished_at": "2026-11-03T10:30:00", "age_hours": 3.0}
    assert overlap_stage(("running", None, 1)) == {"status": "running", "finished_at": None, "age_hours": 1.0}


def test_a_stage_that_never_ran_is_null_and_no_alarm():
    assert overlap_stage(None) is None
    assert overlap_stage_problem(None) is None


def test_a_recent_ok_stage_is_healthy():
    assert overlap_stage_problem({"status": "ok", "finished_at": "x", "age_hours": 20.0}) is None


def test_an_errored_stage_is_an_alarm_however_recent():
    assert overlap_stage_problem({"status": "error", "finished_at": "x", "age_hours": 0.5})


def test_running_is_an_alarm_only_past_six_hours():
    assert OVERLAP_RUNNING_H == 6
    assert overlap_stage_problem({"status": "running", "finished_at": None, "age_hours": 5.9}) is None
    assert overlap_stage_problem({"status": "running", "finished_at": None, "age_hours": 6.1})


def test_a_stale_stage_is_an_alarm_past_thirty_six_hours():
    assert OVERLAP_STALE_H == 36
    assert overlap_stage_problem({"status": "ok", "finished_at": "x", "age_hours": 35.9}) is None
    assert overlap_stage_problem({"status": "ok", "finished_at": "x", "age_hours": 36.1})


# ---------------------------------------------------------------- connections

class FakeEngine:
    """Counts open connections; every statement is a no-op."""
    def __init__(self):
        self.open = 0
        self.opened = 0

    def connect(self):
        engine = self

        class Con:
            def __enter__(self):
                engine.open += 1
                engine.opened += 1
                return self

            def __exit__(self, *exc):
                engine.open -= 1

            def execute(self, *a, **k):
                return None

            def rollback(self):
                pass
        return Con()


def _patch_health(monkeypatch, engine, fail=False):
    import worker.taste_health as h
    from worker import runlog
    finished = []

    def check(data, previous):
        assert engine.open == 0, "a connection is open while computing"
        if fail:
            raise RuntimeError("fit broke")
        return {"checkpoint_due": []}

    monkeypatch.setattr(h, "load_from", lambda con: object())
    monkeypatch.setattr(h, "previous_milestones", lambda con: [])
    monkeypatch.setattr(h, "latest_overlap_stage", lambda con: {"status": "ok", "finished_at": None, "age_hours": 2.0})
    monkeypatch.setattr(h, "check", check)
    monkeypatch.setattr(runlog, "start", lambda con, job: 7)
    monkeypatch.setattr(runlog, "finish", lambda con, rid, status, **d: finished.append((rid, status, engine.open, d)))
    return h, finished


def test_health_computes_with_no_connection_open_and_finishes_on_a_new_one(monkeypatch):
    engine = FakeEngine()
    h, finished = _patch_health(monkeypatch, engine)
    detail = h.run_health(engine)
    assert detail["overlap_stage"]["status"] == "ok"
    assert engine.opened == 2 and engine.open == 0
    assert [(rid, status, n) for rid, status, n, _d in finished] == [(7, "ok", 1)]


def test_health_failure_is_recorded_on_a_new_connection(monkeypatch):
    import pytest
    engine = FakeEngine()
    h, finished = _patch_health(monkeypatch, engine, fail=True)
    with pytest.raises(RuntimeError):
        h.run_health(engine)
    assert [(rid, status, n) for rid, status, n, _d in finished] == [(7, "error", 1)]
    assert engine.open == 0


def test_dry_run_writes_no_row(monkeypatch):
    engine = FakeEngine()
    h, finished = _patch_health(monkeypatch, engine)
    h.run_health(engine, dry_run=True)
    assert finished == [] and engine.opened == 1
