#!/usr/bin/env bash
#
# The launchd agent's entry point: bring the deploy clone up to the tracked ref,
# then run the audio ingest from it.
#
# install.sh copies this file to ~/Library/Application Support/pressd/ — beside
# the clone, not inside it. bash reads a script as it executes it, so a script
# that checks out a new version of itself can run half of each. The copy only
# changes when install.sh is re-run.
#
# Why a clone at all, rather than the working copy: launchd cannot read
# ~/Desktop (macOS privacy protection, "Operation not permitted"), and a working
# copy runs whatever branch or half-finished edit happens to be checked out.
# The clone runs what is merged.
#
#   PRESSD_DEPLOY_REF   branch to run (install.sh sets it; default main)
#   PRESSD_DEPLOY_PULL  0 skips the update and runs the checkout as it stands
#
set -euo pipefail

main() {
  local base clone ref
  base="$(cd "$(dirname "$0")" && pwd)"
  clone="$base/ingest"
  ref="${PRESSD_DEPLOY_REF:-main}"

  echo "=== nightly $(date '+%Y-%m-%d %H:%M:%S %Z') ref=$ref ==="
  if [ "${PRESSD_DEPLOY_PULL:-1}" = "1" ]; then
    # A failed fetch must not cost the night: run the code already here. If the
    # network is really down, the ingest's canary fails and records the error.
    if git -C "$clone" fetch --quiet origin "$ref"; then
      # --force discards any stray edit to tracked files; .env is untracked and
      # ignored, so a checkout never touches it.
      git -C "$clone" checkout --quiet --force --detach "origin/$ref"
    else
      echo "[nightly] git fetch failed; running the checkout already present"
    fi
  fi

  PRESSD_DEPLOY_COMMIT="$(git -C "$clone" rev-parse --short HEAD)"
  export PRESSD_DEPLOY_COMMIT
  echo "[nightly] running $(git -C "$clone" log -1 --format='%h %s')"
  exec /bin/bash "$clone/run_audio_ingest.sh" "$@"
}

# Wrapped in a function so bash parses all of it before running any of it.
main "$@"
