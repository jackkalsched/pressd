"""
Global audio ingest (PLAN_ml_worker_split §2): analyze every unique track
that has no audio features yet, exactly once, shared across all users.

Per-album yt-dlp download + Essentia extraction (source='yt_full'). Requires
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

Usage:
    ./run_audio_ingest.sh [--limit N]      # wrapper: sets PATH for yt-dlp/node/ffmpeg
    ./run_audio_ingest.sh --preflight      # check everything, analyze nothing
    python -m worker.audio_ingest [--limit N]
"""
import argparse
import glob
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlalchemy import text
import backend.models  # noqa: F401 — registers tables in SQLModel.metadata
from backend.database import engine
from worker import runlog
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


class ToolchainError(RuntimeError):
    """The environment cannot download or analyze anything. Aborts the run:
    every remaining track would fail the same way."""


def albums_needing_audio(con, limit: int | None = None):
    """Albums (any user, any status) with ≥1 track lacking analyzed audio.
    Dedup means an album whose tracks were analyzed via another user's copy
    never shows up here."""
    sql = f"""
        SELECT DISTINCT a.id, a.artist, a.album_name
        FROM album a
        JOIN song s ON s.album_id = a.id
        JOIN track t ON t.id = s.track_id
        WHERE {_PENDING}
        ORDER BY a.id
    """
    rows = con.execute(text(sql)).fetchall()
    return rows[:limit] if limit else rows


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


def analyze_album(album_id: int, artist: str, album_name: str) -> tuple[int, int]:
    """Download + analyze this album's un-analyzed tracks; write trackaudio.
    Returns (tracks analyzed, tracks attempted).

    Holds a database connection only to read the to-do list and to write the
    results, never across the downloads. An album is minutes of yt-dlp, and
    Supabase's session pooler allows 15 clients for the whole project, the live
    app included (CLAUDE.md §7)."""
    from backend.routers.audio import _analyze_file

    with engine.connect() as con:
        todo = con.execute(text(f"""
            SELECT s.track_id, s.title, s.track_number
            FROM song s
            WHERE s.album_id = :id AND s.track_id IS NOT NULL AND {_PENDING}
            ORDER BY s.track_number
        """), {"id": album_id}).fetchall()
    if not todo:
        return 0, 0

    results = []
    with tempfile.TemporaryDirectory() as tmpdir:
        why: dict[int, str] = {}
        for track_id, title, track_number in todo:
            out_tmpl = os.path.join(tmpdir, f"{(track_number or 0):03d}_%(title)s.%(ext)s")
            reason = _download(f"ytsearch1:{title} {artist} {album_name}", out_tmpl)
            if reason:
                why[track_number or 0] = reason

        file_by_track: dict[int, str] = {}
        for f in sorted(glob.glob(os.path.join(tmpdir, "*.mp3"))):
            m = re.match(r"^(\d+)_", os.path.basename(f))
            if m:
                file_by_track[int(m.group(1))] = f

        for track_id, title, track_number in todo:
            audio_path = file_by_track.get(track_number or 0)
            if not audio_path:
                print(f"[audio_ingest] no audio for {title}: "
                      f"{why.get(track_number or 0, 'no file produced')}")
                continue
            try:
                results.append((track_id, title, _analyze_file(audio_path)))
            except Exception as e:
                print(f"[audio_ingest] analysis failed for {title}: {e}")

    if not results:
        return 0, len(todo)

    col_names = ", ".join(_FEATURE_COLS)
    set_cols = ", ".join(f"{c} = EXCLUDED.{c}" for c in _FEATURE_COLS)
    placeholders = ", ".join(f":{c}" for c in _FEATURE_COLS)
    analyzed = 0
    with engine.connect() as con:
        for track_id, title, features in results:
            try:
                con.execute(text(
                    f"INSERT INTO trackaudio (track_id, analyzed_at, source, {col_names})"
                    f" VALUES (:tid, NOW(), 'yt_full', {placeholders})"
                    f" ON CONFLICT (track_id) DO UPDATE SET {set_cols},"
                    f" analyzed_at = NOW(), source = 'yt_full'"),
                    {"tid": track_id, **{c: features.get(c) for c in _FEATURE_COLS}})
                con.commit()
                analyzed += 1
                print(f"[audio_ingest] analyzed: {title}")
            except Exception as e:
                con.rollback()
                print(f"[audio_ingest] write failed for {title}: {e}")
    return analyzed, len(todo)


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
            n_alb, n_trk = con.execute(text(f"""
                SELECT COUNT(DISTINCT s.album_id), COUNT(DISTINCT s.track_id)
                FROM song s WHERE s.track_id IS NOT NULL AND {_PENDING}""")).first()
        check("database reachable", True, f"{n_trk} tracks pending across {n_alb} albums")
    except Exception as e:
        check("database reachable", False, str(e).splitlines()[0][:160])
    print(f"[audio_ingest] preflight {'passed' if ok else 'FAILED'}")
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, help="max albums this run")
    ap.add_argument("--preflight", action="store_true",
                    help="check toolchain, canary and database; analyze and record nothing")
    args = ap.parse_args()
    if args.preflight:
        return 0 if preflight() else 1

    with engine.connect() as con:
        run_id = runlog.start(con, "audio_ingest")
    stats = dict(linked=0, albums=0, tracks=0, tracks_attempted=0, failed_or_empty=0)

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
            albums = albums_needing_audio(con, args.limit)
        print(f"[audio_ingest] {stats['linked']} new songs linked; "
              f"{len(albums)} albums have unanalyzed tracks")

        if not albums:
            finish("ok", pending_albums=0)
            return 0

        passed, detail = canary()
        if not passed:
            print(f"[audio_ingest] canary FAILED: {detail} — stopping; "
                  f"nothing downstream can succeed")
            finish("error", pending_albums=len(albums), error=f"canary failed: {detail}")
            return 1

        for i, (album_id, artist, album_name) in enumerate(albums, 1):
            print(f"[audio_ingest] [{i}/{len(albums)}] {artist} – {album_name} (id={album_id})")
            try:
                n, tried = analyze_album(album_id, artist, album_name)
            except ToolchainError:
                raise
            except Exception as e:
                n, tried = 0, 0
                print(f"[audio_ingest] ERROR on album {album_id}: {e}")
            stats["tracks"] += n
            stats["tracks_attempted"] += tried
            stats["albums"] += 1 if n else 0
            stats["failed_or_empty"] += 0 if n else 1
            time.sleep(1)  # be polite between albums

        finish("ok", pending_albums=len(albums))
        print(f"[audio_ingest] done: {stats['tracks']} of {stats['tracks_attempted']} tracks "
              f"across {stats['albums']} albums ({stats['failed_or_empty']} with none)")
        return 0
    except BaseException as e:
        # Includes KeyboardInterrupt: a killed run must not sit at 'running'.
        finish("error", error=f"{type(e).__name__}: {e}"[:500])
        raise


if __name__ == "__main__":
    sys.exit(main())
