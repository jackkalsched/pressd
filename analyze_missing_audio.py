"""
Audio-analyze all to_listen albums (user_id=1) that have no analyzed songs,
then refresh song score predictions via the standard pipeline.

Only runs yt-dlp download + Essentia extraction — no LLM calls, unlike
run_predictions_bulk.py. Logs to analyze_missing_audio.log. Safe to re-run:
already-analyzed songs are skipped.

Usage:
    python analyze_missing_audio.py
"""
import sys
import pathlib
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))

from sqlalchemy import text
from backend.database import engine

LOG = pathlib.Path(__file__).parent / "analyze_missing_audio.log"


def log(msg: str):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG, "a") as f:
        f.write(line + "\n")


def main():
    from theme_predictor.predict_single import _analyze_and_store_songs

    with engine.connect() as con:
        rows = con.execute(text("""
            SELECT a.id, a.artist, a.album_name FROM album a
            WHERE a.user_id = 1 AND a.status = 'to_listen'
            AND NOT EXISTS (
                SELECT 1 FROM song s
                JOIN songaudiofeatures af ON af.song_id = s.id
                WHERE s.album_id = a.id AND af.bpm IS NOT NULL
            )
            ORDER BY a.id
        """)).fetchall()

    total = len(rows)
    log(f"Starting audio analysis for {total} albums with no analyzed songs")

    done, failed = 0, 0
    for i, (album_id, artist, name) in enumerate(rows, 1):
        log(f"[{i}/{total}] {artist} – {name} (id={album_id})")
        try:
            # Fresh connection per album: the run spans hours and long-lived
            # connections get dropped by the pooler
            with engine.connect() as con:
                ok = _analyze_and_store_songs(con, album_id, artist, name)
            if ok:
                done += 1
            else:
                failed += 1
                log("  no songs analyzed")
        except Exception as e:
            failed += 1
            log(f"  ERROR: {e}")

    log(f"Audio analysis complete: {done} albums analyzed, {failed} failed/empty")

    log("Refreshing song score predictions…")
    from song_score_model import repredict_all_song_means
    with engine.connect() as con:
        result = repredict_all_song_means(con)
    log(f"All done: {result}")


if __name__ == "__main__":
    main()
