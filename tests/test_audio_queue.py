"""The audio ingest's download scheduler (worker/audio_ingest.run_queue):
three downloads in flight, the queue's order kept, and a drop to one
downloader — never a stop — when YouTube refuses one. Downloads, analysis and
the database are faked; nothing leaves the process."""
import threading
import time

import pytest

from worker import audio_ingest as ai

_real_sleep = time.sleep

BOT = "ERROR: [youtube] abc: Sign in to confirm you're not a bot"


def _queue(n):
    return [(100 + i, f"song {i}", "artist", "album") for i in range(1, n + 1)]


@pytest.fixture
def harness(monkeypatch):
    """Fake _fetch / _finish_track. `refuse` maps a title to how many times
    its download is refused as a bot before it goes through."""
    state = dict(active=0, peak=0, peak_from_retry=0, retrying=False, fell_back=False,
                 fetched=[], finished=[], refuse={}, lock=threading.Lock())

    def fetch(title, artist, album_name):
        with state["lock"]:
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])
            # From the refused track's second attempt on. Not from the moment
            # of the fallback: a download handed out just before it can start
            # its thread just after, and the scheduler only promises one at a
            # time once it has waited for those, which it does before retrying.
            if title in state["fetched"]:
                state["retrying"] = True
            if state["retrying"]:
                state["peak_from_retry"] = max(state["peak_from_retry"], state["active"])
            state["fetched"].append(title)
            refused = state["refuse"].get(title, 0) > 0
            if refused:
                state["refuse"][title] -= 1
        _real_sleep(0.02)
        with state["lock"]:
            state["active"] -= 1
        return "/nonexistent", (None if refused else f"/{title}.mp3"), (BOT if refused else None)

    def finish(track_id, title, path, reason):
        state["finished"].append((title, path is not None, reason))
        return path is not None

    def fake_sleep(s):  # the fallback's pause; record it instead of waiting
        state["fell_back"] = True

    monkeypatch.setattr(ai, "_fetch", fetch)
    monkeypatch.setattr(ai, "_finish_track", finish)
    monkeypatch.setattr(ai, "FALLBACK_PAUSE_S", 0)
    monkeypatch.setattr(ai.time, "sleep", fake_sleep)
    return state


def _stats():
    return dict(linked=0, tracks=0, tracks_attempted=0, failed=0)


def test_three_in_flight_every_track_once(harness):
    stats = _stats()
    ai.run_queue(_queue(9), stats, downloaders=3)
    assert harness["peak"] == 3
    assert sorted(t for t, _, _ in harness["finished"]) == sorted(f"song {i}" for i in range(1, 10))
    assert stats == dict(linked=0, tracks=9, tracks_attempted=9, failed=0, downloaders=3)


def test_starts_in_queue_order(harness, capsys):
    # The order songs are handed out, which the main thread logs as it submits
    # each one. Not the order the fakes record: three threads can start their
    # downloads in any order, and that isn't the queue's to keep.
    ai.run_queue(_queue(7), _stats(), downloaders=3)
    started = [ln.split("– ")[1].split(" (")[0] for ln in capsys.readouterr().out.splitlines()
               if ln.startswith("[audio_ingest] [")]
    assert started == [f"song {i}" for i in range(1, 8)]


def test_refusal_drops_to_one_downloader_and_keeps_going(harness):
    harness["refuse"] = {"song 2": 1}
    stats = _stats()
    ai.run_queue(_queue(8), stats, downloaders=3)
    # Not stopped: every track got analyzed, the refused one included.
    assert stats["tracks"] == 8 and stats["failed"] == 0
    assert stats["downloaders"] == 1 and stats["fell_back_at"] == 2
    assert "not a bot" in stats["block_reason"]
    # The refused track took no failure: it was retried, and only once finished.
    assert [t for t, _, _ in harness["finished"]].count("song 2") == 1
    assert harness["fetched"].count("song 2") == 2
    # One at a time from then on.
    assert harness["peak_from_retry"] <= 1


def test_refused_track_keeps_its_place(harness, capsys):
    harness["refuse"] = {"song 1": 1}
    ai.run_queue(_queue(6), _stats(), downloaders=3)
    # Read from the scheduler's own log, in the order it hands songs out — not
    # from the fakes, where a download handed out just before the fallback can
    # start its thread just after it. Downloads already handed out finish; the
    # next one handed out is the refused track, ahead of the rest of the queue.
    lines = capsys.readouterr().out.splitlines()
    fell = next(i for i, ln in enumerate(lines) if "YouTube refused a download" in ln)
    after = [ln.split("– ")[1].split(" (")[0] for ln in lines[fell:] if ln.startswith("[audio_ingest] [")]
    assert after[0] == "song 1"
    assert after[1:] == sorted(after[1:], key=lambda t: int(t.split()[1]))
    assert sorted(harness["fetched"]) == sorted(["song 1"] + [f"song {i}" for i in range(1, 7)])


def test_refusal_at_one_downloader_counts_as_a_failure(harness):
    harness["refuse"] = {"song 2": 5}
    stats = _stats()
    ai.run_queue(_queue(4), stats, downloaders=3)
    # Refused in parallel → requeued; refused again at one downloader → a
    # failure like any other, and the run carries on.
    assert stats["tracks"] == 3 and stats["failed"] == 1
    assert ("song 2", False, BOT) in harness["finished"]


def test_one_downloader_from_the_start_never_requeues(harness):
    harness["refuse"] = {"song 1": 1}
    stats = _stats()
    ai.run_queue(_queue(3), stats, downloaders=1)
    assert harness["peak"] == 1
    assert stats["failed"] == 1 and "fell_back_at" not in stats


def test_block_signs():
    assert ai._blocked(BOT)
    assert ai._blocked("ERROR: unable to download video data: HTTP Error 429: Too Many Requests")
    assert not ai._blocked("ERROR: [youtube] abc: Video unavailable")
    assert not ai._blocked("ERROR: [youtube] t_qGKkn6-tE: Sign in to confirm your age. This video may be inappropriate for some users.")
    assert ai._blocked("ERROR: [youtube] RewBHN2nPl8: Sign in to confirm you\u2019re not a bot. This helps protect our community.")
    assert not ai._blocked(None)
