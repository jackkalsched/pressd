"""
Global audio ingest (PLAN_ml_worker_split §2): analyze every unique track
that has no audio features yet, exactly once, shared across all users.

A first-in, first-out queue of recordings (one row per Track, however many
people own the record; see tracks_needing_audio) — library tracks first, then a
capped number of bin records' tracks (BIN_TRACKS_PER_RUN) — each downloaded with yt-dlp
and analyzed with Essentia (source='yt_full') once. A failure goes to the back
of the queue with its reason on the Track. Requires
essentia, yt-dlp, node and ffmpeg, so it runs on the Mac — yt-dlp is
bot-blocked from datacenter IPs. Nightly via launchd (ops/launchd/install.sh);
./run_audio_ingest.sh runs it by hand.

Built to fail loudly, because it failed quietly for five weeks. Between
2026-08-20 and 2026-09-29 every run analyzed 0 tracks of ~85 albums and
recorded status 'ok'. Two things made that invisible, and both are now closed:

  * A broken toolchain looked exactly like tracks with no match. yt-dlp
    without a JavaScript runtime or without ffmpeg still *searches*
    successfully, then produces no file, and the job logged "no audio
    downloaded" per track. So every run starts with a canary: one download of a
    track that always exists. If that fails, nothing downstream can succeed,
    and the run stops with status 'error' instead of retrying 766 tracks.
    Per-track outcomes cannot answer this on their own — about twenty albums
    have no YouTube match on any night, so "zero analyzed" is also what a
    healthy quiet night looks like.
  * Status was always 'ok'. It is now 'error' on a failed canary or any crash
    (a killed run used to stay 'running' forever — see workerrun 547), the
    process exits nonzero, and worker/audio_health.py turns a failed or stale
    run into a red job in GitHub Actions.

A track that fails stops being retried every night. Until October 2026 every
track without audio was tried on every run, forever: the same ~24 (age-gated
explicit tracks, classical movements no search matches, titles mangled into
dates) failed nightly, the worst for 30 nights running. Each failure is now
counted on its Track; after MAX_TRIES it waits RETRY_AFTER_DAYS between
attempts, and a success resets it. The canary is what keeps a broken toolchain
from counting against every track — a run that can't download stops before
it tries any.

Usage:
    ./run_audio_ingest.sh [--limit N]      # wrapper: sets PATH for yt-dlp/node/ffmpeg
    ./run_audio_ingest.sh --preflight      # check everything, analyze nothing
    python -m worker.audio_ingest [--limit N]
"""
import argparse
import glob
import heapq
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlalchemy import text
import backend.models  # noqa: F401 — registers tables in SQLModel.metadata
from backend.database import engine
from worker import runlog
from backend.tracklink import link_bin_entries
from worker.migrate_tracks import sync_tracks, _FEATURE_COLS

DOWNLOAD_TIMEOUT_S = 90

# A recording that will outlive this code. The canary goes through the same
# yt-dlp invocation as every real track, so it proves the path that matters —
# search, the JavaScript challenge, the download, and the ffmpeg extraction —
# rather than just that the binaries exist.
CANARY_SEARCH = "ytsearch1:Queen Bohemian Rhapsody"

# Every external binary the pipeline shells out to, directly or through
# yt-dlp. launchd starts jobs with PATH=/usr/bin:/bin:/usr/sbin:/sbin, which
# contains none of them on this machine.
REQUIRED_TOOLS = ("yt-dlp", "node", "ffmpeg", "ffprobe")

_PENDING = """
    NOT EXISTS (SELECT 1 FROM trackaudio ta
                WHERE ta.track_id = s.track_id AND ta.bpm IS NOT NULL)
"""

# A track that has failed this many runs in a row waits RETRY_AFTER_DAYS
# between further attempts — a YouTube upload can appear later, so it isn't
# dropped for good. Three, so one bad night (a flaky network, a briefly
# refused download) never benches a track on its own.
MAX_TRIES = 3
RETRY_AFTER_DAYS = 7
# Due for an attempt: not yet failed MAX_TRIES times, or rested long enough.
# Needs `track t` joined.
_DUE = f"""
    (t.audio_failures < {MAX_TRIES}
     OR t.audio_failed_at < NOW() - INTERVAL '{RETRY_AFTER_DAYS} days')
"""


class ToolchainError(RuntimeError):
    """The environment cannot download or analyze anything. Aborts the run:
    every remaining track would fail the same way."""


# Bin records' tracks (BinTrack, tracklink.link_bin_entries) queue after every
# library track, and at most this many a night: about an hour at the measured
# 11.9 tracks a minute. Nobody owns those records yet, so they can wait behind
# what people are listening to; and the prediction run is started only once the
# ingest finishes, so an uncapped first night (~3,600 tracks for the first two
# bins, five hours) would hold every user's predictions back by as long.
BIN_TRACKS_PER_RUN = 700


def tracks_needing_audio(con, limit: int | None = None,
                         bin_limit: int = BIN_TRACKS_PER_RUN):
    """The queue: one row per recording with no audio that is due for an
    attempt, first in, first out — (track_id, title, artist, album_name).

    One row per Track, never per album copy. Until November 2026 the job walked
    album copies, so a record two people owned was downloaded twice a night
    (Her Loss, Rodeo and XXXXX were each tried 42 times in six weeks of logs).
    The search terms come from the oldest copy of a song on the recording.

    A track's place in line is when it arrived (`created_at`), or, once it has
    failed, when it last failed (`audio_failed_at`): a failure sends it to the
    back, behind everything already waiting and ahead of what arrives later.
    Before this the order was album id, so every night opened on the oldest
    albums' unfindable tracks while that day's imports waited.

    Then, behind all of that, up to `bin_limit` tracks only a bin holds — no
    copy has the song — searched by the bin entry's artist and title, in the
    same first-in-first-out order (a bin's tracks were made in its order, so a
    record finishes before the next starts). Once anyone imports the record its
    songs link to these same tracks and they move up into the first part."""
    sql = f"""
        SELECT q.track_id, q.title, q.artist, q.album_name FROM (
            SELECT DISTINCT ON (t.id)
                   t.id AS track_id, s.title, a.artist, a.album_name,
                   COALESCE(t.audio_failed_at, t.created_at) AS queued_at
            FROM track t
            JOIN song s ON s.track_id = t.id
            JOIN album a ON a.id = s.album_id
            WHERE {_PENDING} AND {_DUE}
            ORDER BY t.id, a.id
        ) q
        ORDER BY q.queued_at, q.track_id
    """
    if limit:
        sql += " LIMIT :limit"
    rows = con.execute(text(sql), {"limit": limit} if limit else {}).fetchall()
    room = bin_limit if not limit else min(bin_limit, limit - len(rows))
    if room <= 0:
        return rows
    return rows + con.execute(text(f"""
        SELECT q.track_id, q.title, q.artist, q.album_name FROM (
            SELECT DISTINCT ON (t.id)
                   t.id AS track_id, bt.title, e.artist, e.album_name,
                   COALESCE(t.audio_failed_at, t.created_at) AS queued_at
            FROM track t
            JOIN bintrack bt ON bt.track_id = t.id
            JOIN binentry e ON e.id = bt.entry_id
            WHERE NOT EXISTS (SELECT 1 FROM trackaudio ta
                              WHERE ta.track_id = t.id AND ta.bpm IS NOT NULL)
              AND NOT EXISTS (SELECT 1 FROM song s WHERE s.track_id = t.id)
              AND {_DUE}
            ORDER BY t.id, e.id
        ) q
        ORDER BY q.queued_at, q.track_id
        LIMIT :room
    """), {"room": room}).fetchall()


def _ytdlp_cmd(out_tmpl: str, search: str) -> list[str]:
    # --js-runtimes node is load-bearing, not a tuning flag. YouTube gates the
    # media URL behind a JavaScript challenge; without a runtime to solve it
    # every download fails while *search* still succeeds. yt-dlp only enables
    # deno by default, and node is what this machine has.
    return ["yt-dlp", "--js-runtimes", "node",
            "--default-search", "ytsearch", "--no-playlist",
            "-x", "--audio-format", "mp3", "--audio-quality", "0",
            "--socket-timeout", "30",
            "-o", out_tmpl, search]


def _download(search: str, out_tmpl: str) -> str | None:
    """Run yt-dlp once. None on success, otherwise a one-line reason — the
    last ERROR line yt-dlp printed, which is what tells a blocked download
    from a missing match."""
    try:
        r = subprocess.run(_ytdlp_cmd(out_tmpl, search),
                           capture_output=True, text=True, timeout=DOWNLOAD_TIMEOUT_S)
    except FileNotFoundError as e:
        raise ToolchainError("yt-dlp is not on PATH") from e
    except subprocess.TimeoutExpired:
        return f"timed out after {DOWNLOAD_TIMEOUT_S}s"
    if r.returncode != 0:
        errors = [ln for ln in (r.stderr or "").splitlines() if ln.startswith("ERROR")]
        return (errors[-1] if errors else f"yt-dlp exited {r.returncode}")[:240]
    return None


def canary(analyze: bool = False) -> tuple[bool, str]:
    """Download one known track through the real invocation; optionally run
    Essentia on it too. Retries once, so a network blip doesn't cost a night."""
    with tempfile.TemporaryDirectory() as d:
        why = "no file produced"
        for attempt in (1, 2):
            try:
                why = _download(CANARY_SEARCH, os.path.join(d, "canary.%(ext)s")) or why
            except ToolchainError as e:
                return False, str(e)
            mp3s = glob.glob(os.path.join(d, "*.mp3"))
            if mp3s:
                if analyze:
                    try:
                        from backend.routers.audio import _analyze_file
                        feats = _analyze_file(mp3s[0])
                        return True, f"downloaded and analyzed (bpm {feats.get('bpm', 0):.0f})"
                    except Exception as e:
                        return False, f"downloaded, but Essentia failed: {e}"
                return True, "downloaded"
            if attempt == 1:
                time.sleep(30)
        return False, why


def _record_failure(track_id: int, reason: str) -> None:
    """Note why, and send the track to the back of the queue: its place in
    line becomes now (`audio_failed_at`). The strike counts once per 12 hours,
    so a crashed run and the catch-up that follows it are one bad night, not
    two."""
    with engine.connect() as con:
        con.execute(text(
            "UPDATE track SET audio_failures = audio_failures"
            " + CASE WHEN audio_failed_at > NOW() - INTERVAL '12 hours' THEN 0 ELSE 1 END,"
            " audio_failed_at = NOW(), audio_fail_reason = :r WHERE id = :tid"),
            {"tid": track_id, "r": reason[:240]})
        con.commit()


def _store_features(track_id: int, features: dict) -> None:
    col_names = ", ".join(_FEATURE_COLS)
    set_cols = ", ".join(f"{c} = EXCLUDED.{c}" for c in _FEATURE_COLS)
    placeholders = ", ".join(f":{c}" for c in _FEATURE_COLS)
    with engine.connect() as con:
        con.execute(text(
            f"INSERT INTO trackaudio (track_id, analyzed_at, source, {col_names})"
            f" VALUES (:tid, NOW(), 'yt_full', {placeholders})"
            f" ON CONFLICT (track_id) DO UPDATE SET {set_cols},"
            f" analyzed_at = NOW(), source = 'yt_full'"),
            {"tid": track_id, **{c: features.get(c) for c in _FEATURE_COLS}})
        con.execute(text(
            "UPDATE track SET audio_failures = 0, audio_failed_at = NULL,"
            " audio_fail_reason = NULL WHERE id = :tid"), {"tid": track_id})
        con.commit()


# Downloads in flight at once. Measured 2026-11-09 from the Mac, ten songs a
# setting with the old one-at-a-time run going alongside: 1 → 4.2 tracks/min,
# 2 → 9.4, 3 → 11.9, every download succeeding and none slower for the
# company. YouTube's bot checks answer sustained volume rather than bursts,
# so a run that meets one drops to a single downloader for the rest of the
# night (see run_queue) — slower, never stopped.
DOWNLOADERS = 3
# How YouTube says "slow down" in yt-dlp's last ERROR line, as opposed to "no
# such video": a rate limit, or the sign-in wall it puts up for suspected bots
# ("Sign in to confirm you're not a bot", with a curly or straight apostrophe).
# Not a bare "sign in to confirm": an age-gated video says "Sign in to confirm
# your age", a fact about that one video. Matched as a block, it dropped the
# runs of 2026-11-11 and -12 to one downloader at their sixth and eighth track,
# and the second of them took fifteen hours.
BLOCK_SIGNS = ("http error 429", "too many requests", "not a bot",
               "rate-limit", "rate limit")
# A breather before the single downloader carries on.
FALLBACK_PAUSE_S = 60


def _blocked(reason: str | None) -> bool:
    return bool(reason) and any(s in reason.lower() for s in BLOCK_SIGNS)


def _fetch(title: str, artist: str, album_name: str) -> tuple[str, str | None, str | None]:
    """Download one recording into a directory of its own. Runs on a download
    thread, so it touches neither Essentia nor the database. Returns (that
    directory, the mp3 or None, yt-dlp's reason when there's no file)."""
    tmpdir = tempfile.mkdtemp(prefix="pressd-ingest-")
    try:
        reason = _download(f"ytsearch1:{title} {artist} {album_name}",
                           os.path.join(tmpdir, "track.%(ext)s"))
    except BaseException:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise
    mp3s = glob.glob(os.path.join(tmpdir, "*.mp3"))
    return tmpdir, (mp3s[0] if mp3s else None), reason


def _finish_track(track_id: int, title: str, path: str | None, reason: str | None) -> bool:
    """Analyze and store one downloaded recording, or note why there's
    nothing to analyze and send it to the back of the queue. True when it got
    audio. On the main thread only: Essentia runs one track at a time.

    Holds a database connection only for the write, never across a download:
    Supabase's session pooler allows 15 clients for the whole project, the
    live app included (CLAUDE.md §7)."""
    from backend.routers.audio import _analyze_file

    if not path:
        reason = reason or "no file produced"
        print(f"[audio_ingest] no audio for {title}: {reason}")
        _record_failure(track_id, reason)
        return False
    try:
        features = _analyze_file(path)
    except Exception as e:
        print(f"[audio_ingest] analysis failed for {title}: {e}")
        _record_failure(track_id, f"analysis failed: {e}")
        return False
    try:
        _store_features(track_id, features)
    except Exception as e:
        print(f"[audio_ingest] write failed for {title}: {e}")
        return False
    print(f"[audio_ingest] analyzed: {title}")
    return True


def run_queue(queue, stats: dict, downloaders: int = DOWNLOADERS) -> None:
    """Work through the queue in order with `downloaders` downloads in flight,
    analyzing each file on this thread as it lands.

    The first download YouTube refuses as a bot or a rate limit drops the run
    to one downloader — the old one-at-a-time pipeline — for the rest of the
    night, after FALLBACK_PAUSE_S. That track, and any other started in
    parallel that comes back refused, goes back to its own place in line
    rather than taking a failure: the refusal was about the pace, not the
    song. Once at one downloader a refusal counts like any other failure, as
    it always did."""
    from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

    total = len(queue)
    waiting = list(enumerate(queue, 1))  # (place, row); sorted, so a heap
    heapq.heapify(waiting)
    in_flight: dict = {}  # future -> (place, row, started while parallel)
    stats["downloaders"] = downloaders

    with ThreadPoolExecutor(max_workers=max(downloaders, 1)) as pool:
        while waiting or in_flight:
            while waiting and len(in_flight) < downloaders:
                place, row = heapq.heappop(waiting)
                track_id, title, artist, album_name = row
                print(f"[audio_ingest] [{place}/{total}] {artist} – {title} "
                      f"({album_name}; track {track_id})")
                in_flight[pool.submit(_fetch, title, artist, album_name)] = (
                    place, row, downloaders > 1)

            done, _ = wait(in_flight, return_when=FIRST_COMPLETED)
            for fut in sorted(done, key=lambda f: in_flight[f][0]):
                place, row, parallel = in_flight.pop(fut)
                track_id, title, _, _ = row
                try:
                    tmpdir, path, reason = fut.result()
                except ToolchainError:
                    raise
                except Exception as e:
                    print(f"[audio_ingest] ERROR on track {track_id}: {e}")
                    stats["tracks_attempted"] += 1
                    stats["failed"] += 1
                    continue
                try:
                    if not path and parallel and _blocked(reason):
                        heapq.heappush(waiting, (place, row))
                        if downloaders > 1:
                            downloaders = 1
                            stats.update(downloaders=1, fell_back_at=place,
                                         block_reason=reason[:240])
                            print(f"[audio_ingest] YouTube refused a download ({reason}) — "
                                  f"one downloader for the rest of the run, "
                                  f"after {FALLBACK_PAUSE_S}s")
                            time.sleep(FALLBACK_PAUSE_S)
                        continue
                    ok = _finish_track(track_id, title, path, reason)
                finally:
                    shutil.rmtree(tmpdir, ignore_errors=True)
                stats["tracks_attempted"] += 1
                stats["tracks" if ok else "failed"] += 1


def preflight() -> bool:
    """Everything a nightly run needs, checked without writing a row. Run it
    from launchd's own environment (ops/launchd/install.sh does) — a shell's
    PATH is not the one that matters."""
    ok = True

    def check(name: str, passed: bool, detail: str = ""):
        nonlocal ok
        ok = ok and passed
        print(f"  {'✓' if passed else '✗'} {name}" + (f" — {detail}" if detail else ""))

    print("[audio_ingest] preflight"
          + (f" (deploy commit {os.environ['PRESSD_DEPLOY_COMMIT']})"
             if os.getenv("PRESSD_DEPLOY_COMMIT") else ""))
    for tool in REQUIRED_TOOLS:
        path = shutil.which(tool)
        check(f"{tool} on PATH", bool(path), path or f"not found in PATH={os.environ.get('PATH')}")
    if shutil.which("yt-dlp"):
        v = subprocess.run(["yt-dlp", "--version"], capture_output=True, text=True)
        check("yt-dlp runs", v.returncode == 0, v.stdout.strip() or v.stderr.strip()[:120])
    try:
        from backend.routers.audio import _analyze_file  # noqa: F401
        import essentia  # noqa: F401
        check("Essentia imports", True, getattr(essentia, "__version__", ""))
    except Exception as e:
        check("Essentia imports", False, str(e)[:160])
    passed, detail = canary(analyze=True)
    check("canary download + analysis", passed, detail)
    try:
        with engine.connect() as con:
            n_alb, n_trk, n_rest = con.execute(text(f"""
                SELECT COUNT(DISTINCT s.album_id) FILTER (WHERE {_DUE}),
                       COUNT(DISTINCT s.track_id) FILTER (WHERE {_DUE}),
                       COUNT(DISTINCT s.track_id) FILTER (WHERE NOT {_DUE})
                FROM song s JOIN track t ON t.id = s.track_id
                WHERE {_PENDING}""")).first()
        check("database reachable", True,
              f"{n_trk} tracks due across {n_alb} albums; {n_rest} resting after {MAX_TRIES} failures")
    except Exception as e:
        check("database reachable", False, str(e).splitlines()[0][:160])
    print(f"[audio_ingest] preflight {'passed' if ok else 'FAILED'}")
    return ok


# The GitHub workflow this hands off to once audio is in.
PREDICT_WORKFLOW = "nightly-predict.yml"
GITHUB_REPO = os.getenv("PRESSD_GITHUB_REPO", "jackkalsched/pressd")


def start_predictions() -> None:
    """Start tonight's prediction run on GitHub now that the audio is in.

    The workflow's own cron fired 5–9 hours late through October 2026 —
    GitHub's scheduler, not the Mac: the six-hourly new-releases workflow,
    which never touches the Mac, slipped just as far. Starting it from here
    makes predictions follow the audio they read, minutes after it lands. The
    cron stays as the fallback for a night the Mac doesn't run, and skips
    itself when this already has (nightly_predict --skip-if-ran-within).

    Needs GITHUB_DISPATCH_TOKEN in .env: a fine-grained token for this
    repository with "Actions: read and write" and nothing else. Without one, or
    if GitHub refuses, it says so and the night still counts — the cron will
    run predictions later, as before."""
    token = os.getenv("GITHUB_DISPATCH_TOKEN")
    if not token:
        print("[audio_ingest] no GITHUB_DISPATCH_TOKEN; predictions wait for GitHub's schedule")
        return
    req = urllib.request.Request(
        f"https://api.github.com/repos/{GITHUB_REPO}/actions/workflows/{PREDICT_WORKFLOW}/dispatches",
        data=json.dumps({"ref": "main"}).encode(), method="POST",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "pressd-audio-ingest"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            print(f"[audio_ingest] started tonight's predictions on GitHub (HTTP {resp.status})")
    except urllib.error.HTTPError as e:
        print(f"[audio_ingest] GitHub refused to start predictions: HTTP {e.code} "
              f"{e.read()[:200].decode(errors='replace')}")
    except Exception as e:
        print(f"[audio_ingest] couldn't reach GitHub to start predictions: {e}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, help="max tracks this run")
    ap.add_argument("--downloaders", type=int, default=DOWNLOADERS,
                    help=f"downloads in flight at once (default {DOWNLOADERS}); "
                         f"drops to 1 if YouTube refuses one")
    ap.add_argument("--preflight", action="store_true",
                    help="check toolchain, canary and database; analyze and record nothing")
    args = ap.parse_args()
    if args.preflight:
        return 0 if preflight() else 1

    with engine.connect() as con:
        run_id = runlog.start(con, "audio_ingest")
    stats = dict(linked=0, tracks=0, tracks_attempted=0, failed=0)

    # Set by ops/launchd/nightly.sh: which commit of the deploy clone ran, so a
    # failure in workerrun can be tied to a change. Absent on hand-run jobs.
    commit = os.getenv("PRESSD_DEPLOY_COMMIT")

    def finish(status: str, **extra):
        with engine.connect() as con:
            runlog.finish(con, run_id, status, **stats, **extra,
                          **({"commit": commit} if commit else {}))

    try:
        with engine.connect() as con:
            stats["linked"] = sync_tracks(con)  # link songs imported since last run
            # A bin imported since: its records' songs onto Tracks (a no-op
            # normally; worker/import_bin.py does it as it writes).
            stats["bin_songs_linked"] = link_bin_entries(con)["songs"]
            queue = tracks_needing_audio(con, args.limit)
        print(f"[audio_ingest] {stats['linked']} new songs linked; "
              f"{len(queue)} tracks in the queue")

        if not queue:
            finish("ok", pending_tracks=0)
            if commit:  # the nightly run, not one by hand
                start_predictions()
            return 0

        passed, detail = canary()
        if not passed:
            print(f"[audio_ingest] canary FAILED: {detail} — stopping; "
                  f"nothing downstream can succeed")
            finish("error", pending_tracks=len(queue), error=f"canary failed: {detail}")
            return 1

        run_queue(queue, stats, args.downloaders)

        finish("ok", pending_tracks=len(queue))
        print(f"[audio_ingest] done: {stats['tracks']} of {stats['tracks_attempted']} tracks "
              f"analyzed ({stats['failed']} sent to the back of the queue)"
              + (f"; fell back to one downloader at track {stats['fell_back_at']}"
                 if "fell_back_at" in stats else ""))
        if commit:  # the nightly run, not one by hand
            start_predictions()
        return 0
    except BaseException as e:
        # Includes KeyboardInterrupt: a killed run must not sit at 'running'.
        finish("error", error=f"{type(e).__name__}: {e}"[:500])
        raise


if __name__ == "__main__":
    sys.exit(main())
