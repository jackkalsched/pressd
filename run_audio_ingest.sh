#!/usr/bin/env bash
#
# Run the audio analysis (yt-dlp download + Essentia extraction) for every
# album with tracks that have no audio features yet. launchd runs this nightly
# (ops/launchd/install.sh); run it by hand whenever you like:
#
#   ./run_audio_ingest.sh              # analyze all albums with missing audio
#   ./run_audio_ingest.sh --limit 20   # cap this run to 20 albums
#   ./run_audio_ingest.sh --preflight  # check the toolchain; analyze nothing
#
# PRESSD_UPDATE_YTDLP=1 upgrades yt-dlp first. The launchd job sets it: when
# YouTube changes something, a new yt-dlp release is almost always the fix, and
# an unattended job has nobody to install it.
#
set -euo pipefail

# Run from the repo root so backend/database.py's load_dotenv() finds .env
cd "$(dirname "$0")"

# Everything the job shells out to, whoever invokes it. launchd starts jobs with
# PATH=/usr/bin:/bin:/usr/sbin:/sbin, which has none of these:
#   Python framework bin — python3, yt-dlp
#   /usr/local/bin       — node (yt-dlp's JavaScript runtime), ffmpeg, ffprobe
# Without the second, yt-dlp still searches but produces no file, so every track
# reads as "no match". That is how the previous launchd agent failed.
PYBIN="/Library/Frameworks/Python.framework/Versions/3.13/bin"
export PATH="$PYBIN:/usr/local/bin:/opt/homebrew/bin:$PATH"

# Python block-buffers stdout when it isn't a terminal. Under launchd the log is
# a file, so progress sat in an 8 KB buffer and `tail -f` showed nothing for
# minutes while tracks were already landing in trackaudio.
export PYTHONUNBUFFERED=1

echo "=== audio ingest $(date '+%Y-%m-%d %H:%M:%S %Z') $* ==="

if [ "${PRESSD_UPDATE_YTDLP:-0}" = "1" ]; then
  # A failed upgrade must not cost the night: the installed version may be fine.
  "$PYBIN/python3" -m pip install --quiet --upgrade --disable-pip-version-check yt-dlp \
    || echo "[run_audio_ingest] yt-dlp upgrade failed; continuing with $(yt-dlp --version)"
fi

exec "$PYBIN/python3" -m worker.audio_ingest "$@"
