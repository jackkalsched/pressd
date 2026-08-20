"""
Global audio ingest (PLAN_ml_worker_split §2): analyze every unique track
that has no audio features yet, exactly once, shared across all users.

No-op on nights with no new unique tracks. Per-album yt-dlp download +
Essentia extraction (source='yt_full'); the 30s-preview source replaces the
acquisition step later (rollout steps 6–7). Requires essentia + yt-dlp —
run where those work (the local Mac, on demand via ./run_audio_ingest.sh).

Usage:
    ./run_audio_ingest.sh [--limit N]      # convenience wrapper (sets PATH)
    python -m worker.audio_ingest [--limit N]
"""
import argparse
import sys
import pathlib
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlalchemy import text
import backend.models  # noqa: F401 — registers tables in SQLModel.metadata
from backend.database import engine
from worker import runlog
from worker.migrate_tracks import sync_tracks, _FEATURE_COLS


def albums_needing_audio(con, limit: int | None = None):
    """Albums (any user, any status) with ≥1 track lacking analyzed audio.
    Dedup means an album whose tracks were analyzed via another user's copy
    never shows up here."""
    sql = """
        SELECT DISTINCT a.id, a.artist, a.album_name
        FROM album a
        JOIN song s ON s.album_id = a.id
        JOIN track t ON t.id = s.track_id
        WHERE NOT EXISTS (
            SELECT 1 FROM trackaudio ta
            WHERE ta.track_id = s.track_id AND ta.bpm IS NOT NULL
        )
        ORDER BY a.id
    """
    rows = con.execute(text(sql)).fetchall()
    return rows[:limit] if limit else rows


def analyze_album(con, album_id: int, artist: str, album_name: str) -> int:
    """Download + analyze this album's un-analyzed tracks; write trackaudio.
    Returns the number of tracks analyzed."""
    import tempfile, subprocess, os, glob, re
    from backend.routers.audio import _analyze_file

    todo = con.execute(text("""
        SELECT s.track_id, s.title, s.track_number
        FROM song s
        WHERE s.album_id = :id AND s.track_id IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM trackaudio ta
            WHERE ta.track_id = s.track_id AND ta.bpm IS NOT NULL
        )
        ORDER BY s.track_number
    """), {"id": album_id}).fetchall()
    if not todo:
        return 0

    analyzed = 0
    with tempfile.TemporaryDirectory() as tmpdir:
        for track_id, title, track_number in todo:
            search = f"ytsearch1:{title} {artist} {album_name}"
            out_tmpl = os.path.join(tmpdir, f"{(track_number or 0):03d}_%(title)s.%(ext)s")
            try:
                subprocess.run(
                    # --js-runtimes node is load-bearing, not a tuning flag.
                    # YouTube now gates the media URL behind a JavaScript
                    # challenge; without a runtime to solve it every download
                    # returns 403 while *search* still succeeds, so the job
                    # reports "no audio downloaded" per track and looks like a
                    # matching problem rather than a broken one. yt-dlp only
                    # enables deno by default, and node is what this machine
                    # has.
                    ["yt-dlp", "--js-runtimes", "node",
                     "--default-search", "ytsearch", "--no-playlist",
                     "-x", "--audio-format", "mp3", "--audio-quality", "0",
                     "-o", out_tmpl, search],
                    capture_output=True, text=True, timeout=90,
                )
            except Exception:
                continue

        file_by_track: dict[int, str] = {}
        for f in sorted(glob.glob(os.path.join(tmpdir, "*.mp3"))):
            m = re.match(r"^(\d+)_", os.path.basename(f))
            if m:
                file_by_track[int(m.group(1))] = f

        col_names = ", ".join(_FEATURE_COLS)
        set_cols = ", ".join(f"{c} = EXCLUDED.{c}" for c in _FEATURE_COLS)
        placeholders = ", ".join(f":{c}" for c in _FEATURE_COLS)

        for track_id, title, track_number in todo:
            audio_path = file_by_track.get(track_number or 0)
            if not audio_path:
                print(f"[audio_ingest] no audio downloaded for: {title}")
                continue
            try:
                features = _analyze_file(audio_path)
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
                print(f"[audio_ingest] failed for {title}: {e}")

    return analyzed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, help="max albums this run")
    args = ap.parse_args()

    with engine.connect() as con:
        run_id = runlog.start(con, "audio_ingest")
        n_linked = sync_tracks(con)  # link songs imported since last run
        albums = albums_needing_audio(con, args.limit)

    print(f"[audio_ingest] {n_linked} new songs linked; "
          f"{len(albums)} albums have unanalyzed tracks")

    n_tracks, n_albums, n_failed = 0, 0, 0
    for i, (album_id, artist, album_name) in enumerate(albums, 1):
        print(f"[audio_ingest] [{i}/{len(albums)}] {artist} – {album_name} (id={album_id})")
        try:
            # Fresh connection per album: multi-hour runs outlive pooled connections
            with engine.connect() as con:
                n = analyze_album(con, album_id, artist, album_name)
            n_tracks += n
            n_albums += 1 if n else 0
            if not n:
                n_failed += 1
        except Exception as e:
            n_failed += 1
            print(f"[audio_ingest] ERROR on album {album_id}: {e}")
        time.sleep(1)  # be polite between albums

    with engine.connect() as con:
        runlog.finish(con, run_id, "ok", linked=n_linked, albums=n_albums,
                      tracks=n_tracks, failed_or_empty=n_failed)
    print(f"[audio_ingest] done: {n_tracks} tracks across {n_albums} albums "
          f"({n_failed} failed/empty)")


if __name__ == "__main__":
    main()
