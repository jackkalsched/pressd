"""
Bulk prediction runner for all to_listen albums (user_id=1).
Runs audio analysis + song score model + theme/distinctness + replay for each album.
Logs to run_predictions_bulk.log
"""
import sys
import pathlib
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))

from backend.database import engine
from sqlalchemy import text

LOG = pathlib.Path(__file__).parent / "run_predictions_bulk.log"


def log(msg: str):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG, "a") as f:
        f.write(line + "\n")


def main():
    from theme_predictor.predict_single import _run

    with engine.connect() as con:
        rows = con.execute(
            text("SELECT id, artist, album_name FROM album WHERE user_id=1 AND status='to_listen' ORDER BY id")
        ).fetchall()

    total = len(rows)
    log(f"Starting bulk predictions for {total} to_listen albums")

    for i, (album_id, artist, album_name) in enumerate(rows, 1):
        log(f"[{i}/{total}] {artist} – {album_name} (id={album_id})")
        try:
            _run(album_id)
        except Exception as e:
            log(f"  ERROR: {e}")
        log(f"  done ({i}/{total})")

    log("Bulk predictions complete. Running theme normalization pass…")
    from theme_predictor.predict_single import normalize_predicted_themes, recompute_all_predictions
    normalize_predicted_themes()
    log("Theme normalization done. Recomputing final scores…")
    recompute_all_predictions()
    log("All done.")


if __name__ == "__main__":
    main()
