"""
Manually refresh predicted_song_mean for all to_listen albums using the
current song score model, then recompute composite predicted scores.

The backend runs the same pipeline automatically whenever an album is rated
(see _queue_song_repredictions in backend/routers/albums.py); this script is
for running it by hand.

Usage:
    python repredict_song_means.py
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent))

from backend.database import engine
from song_score_model import repredict_all_song_means

if __name__ == "__main__":
    with engine.connect() as con:
        result = repredict_all_song_means(con)
    print(f"Done: {result}")
