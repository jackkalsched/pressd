#!/usr/bin/env bash
#
# Manually run the audio analysis (yt-dlp download + Essentia extraction) for
# every album with tracks that have no audio features yet. This is the job that
# used to run nightly via launchd — now it's on-demand: run it whenever you want
# to fill in missing audio.
#
#   ./run_audio_ingest.sh              # analyze all albums with missing audio
#   ./run_audio_ingest.sh --limit 20   # cap this run to 20 albums
#
# Output prints live to your terminal. To run it in the background and log to a
# file instead:
#   nohup ./run_audio_ingest.sh > audio_ingest.log 2>&1 &
#   tail -f audio_ingest.log
#
set -euo pipefail

# Run from the repo root so backend/database.py's load_dotenv() finds .env
cd "$(dirname "$0")"

# yt-dlp lives in the Python framework bin; make sure it's on PATH regardless of
# how this script is invoked (Finder, cron, a bare shell, etc.)
export PATH="/Library/Frameworks/Python.framework/Versions/3.13/bin:$PATH"

exec /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 -m worker.audio_ingest "$@"
