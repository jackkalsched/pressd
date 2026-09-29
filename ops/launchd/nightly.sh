#!/usr/bin/env bash
#
# The launchd agents' entry point: bring the deploy clone up to the tracked
# ref, then run the audio ingest from it.
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
# When it runs. The laptop is usually shut or asleep at 00:30, so the run that
# matters in practice is the one when it is next opened:
#   * com.pressd.audio-ingest — 00:30 local. If the Mac is asleep then, launchd
#     starts the job on the next wake (missed runs coalesce into one).
#   * com.pressd.audio-ingest.login — at login, with --catch-up. launchd's wake
#     catch-up does not cover a Mac that was shut down rather than asleep; this
#     does, and does nothing if a run succeeded in the last CATCHUP_AFTER_H hours.
# A wake-triggered run starts before Wi-Fi has reassociated, and the ingest's
# first act is a database connection, so the run waits for the network first.
# The two agents can fire together (log in at 00:29), so a run holds a lock.
#
#   --catch-up          skip unless the last success is over CATCHUP_AFTER_H old
#   PRESSD_DEPLOY_REF   branch to run (install.sh sets it; default main)
#   PRESSD_DEPLOY_PULL  0 skips the update and runs the checkout as it stands
#
set -euo pipefail

CATCHUP_AFTER_H=20
NETWORK_WAIT_S=180

wait_for_network() {
  local waited=0
  until /usr/bin/curl -sf -o /dev/null --max-time 5 https://github.com; do
    if [ "$waited" -ge "$NETWORK_WAIT_S" ]; then
      echo "[nightly] no network after ${NETWORK_WAIT_S}s; trying anyway"
      return 0
    fi
    [ "$waited" = 0 ] && echo "[nightly] waiting for the network…"
    sleep 5
    waited=$((waited + 5))
  done
  if [ "$waited" -gt 0 ]; then echo "[nightly] network up after ${waited}s"; fi
  return 0
}

main() {
  local base clone ref stamp catch_up=0 age_h rc=0
  base="$(cd "$(dirname "$0")" && pwd)"

  # One run at a time, taken before anything else. lockf's lock belongs to the
  # process and vanishes with it, so a killed run cannot leave a stale lock.
  # -t 0: if another run holds it, exit now (status 75) rather than queue a
  # second full run behind it.
  if [ "${PRESSD_LOCKED:-0}" != 1 ]; then
    PRESSD_LOCKED=1 exec /usr/bin/lockf -t 0 "$base/.run.lock" /bin/bash "$0" "$@"
  fi

  clone="$base/ingest"
  ref="${PRESSD_DEPLOY_REF:-main}"
  stamp="$base/last_success"
  if [ "${1:-}" = "--catch-up" ]; then catch_up=1; shift; fi

  if [ "$catch_up" = 1 ] && [ -f "$stamp" ]; then
    age_h=$(( ($(date +%s) - $(stat -f %m "$stamp")) / 3600 ))
    if [ "$age_h" -lt "$CATCHUP_AFTER_H" ]; then
      echo "=== catch-up $(date '+%Y-%m-%d %H:%M:%S %Z'): last success ${age_h}h ago, nothing to do ==="
      return 0
    fi
  fi

  echo "=== nightly $(date '+%Y-%m-%d %H:%M:%S %Z') ref=$ref$([ "$catch_up" = 1 ] && echo ' (login catch-up)') ==="
  wait_for_network

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
  /bin/bash "$clone/run_audio_ingest.sh" "$@" || rc=$?

  # The catch-up agent reads this. Only a real run that finished counts — not a
  # preflight, and not a run that failed its canary or crashed.
  case " $* " in *" --preflight "*) ;; *) [ "$rc" = 0 ] && touch "$stamp" ;; esac
  return "$rc"
}

# Wrapped in a function so bash parses all of it before running any of it.
main "$@"
