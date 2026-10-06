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
#   * com.pressd.audio-ingest.catchup — at login and every 30 minutes, with
#     --catch-up: runs only when tonight's run hasn't succeeded yet.
#
# Why the catch-up is periodic, not at login (October 2026). On Oct 3–5 the
# Mac slept on battery through 00:30; macOS woke it for 5–9 s of "DarkWake"
# upkeep at ~00:50 and launchd spent the missed run on that. A dark wake never
# brings Wi-Fi up, so the run waited, found no network and failed at its
# database connection — or froze mid-run and resumed hours later, the moment
# the lid opened, before Wi-Fi had reconnected. The old catch-up ran only at
# *login*, and opening the lid is a wake, not a login, so nothing retried until
# the next night: three failed nights, and GitHub's audio-health went red.
# Checking every 30 minutes lets the first awake, online half-hour after a
# missed night do the run. Neither agent starts a run in a dark wake at all
# (`fully_awake`): on Oct 6 one that did crept along for 22 hours.
#
# "Hasn't succeeded yet" means: no success since the most recent 00:30, and at
# least CATCHUP_GRACE_MIN past it, so the scheduled run gets its chance first.
# It used to be "no success in 20h", which a periodic check would turn into a
# schedule that creeps earlier each day (success at 20:42, next due 16:42…).
#
# No network is not a failure. The scheduled run waits up to NETWORK_WAIT_S for
# one, a catch-up CATCHUP_NETWORK_WAIT_S; either then exits 0 and leaves the
# night to the next catch-up, rather than crashing at the database. The agents
# can fire together, so a run holds a lock.
#
#   --catch-up          skip unless tonight's run hasn't succeeded yet
#   PRESSD_DEPLOY_REF   branch to run (install.sh sets it; default main)
#   PRESSD_DEPLOY_PULL  0 skips the update and runs the checkout as it stands
#
set -euo pipefail

SCHEDULED_AT="00:30"          # keep in step with install.sh's StartCalendarInterval
CATCHUP_GRACE_MIN=60
NETWORK_WAIT_S=180
CATCHUP_NETWORK_WAIT_S=60

# Succeeds once the database host resolves and GitHub answers — both are what
# the run needs first. Waits up to $1 seconds. Counted in wall-clock time, not
# loop turns: a Mac that sleeps mid-wait resumes hours later, and the wait
# should be over by then rather than restart its count.
wait_for_network() {
  local limit="$1" start now
  start=$(date +%s)
  while :; do
    if /usr/bin/curl -sf -o /dev/null --max-time 5 https://github.com \
       && /usr/bin/host -W 5 aws-1-us-east-2.pooler.supabase.com >/dev/null 2>&1; then
      now=$(date +%s)
      [ $((now - start)) -gt 0 ] && echo "[nightly] network up after $((now - start))s"
      return 0
    fi
    now=$(date +%s)
    [ $((now - start)) -ge "$limit" ] && return 1
    sleep 5
  done
}

# True in a full wake; false in a dark wake, which is the state that drops the
# Graphics capability (a closed lid with an external display keeps it).
fully_awake() {
  /usr/bin/pmset -g systemstate | /usr/bin/grep -q Graphics
}

# Epoch of the most recent SCHEDULED_AT (today's if it has passed, else
# yesterday's), local time.
last_scheduled() {
  local today at
  today=$(date +%Y-%m-%d)
  at=$(date -j -f "%Y-%m-%d %H:%M" "$today $SCHEDULED_AT" +%s)
  [ "$(date +%s)" -lt "$at" ] && at=$((at - 86400))
  echo "$at"
}

main() {
  local base clone ref stamp catch_up=0 sched rc=0
  base="$(cd "$(dirname "$0")" && pwd)"

  # One run at a time, taken before anything else. lockf's lock belongs to the
  # process and vanishes with it, so a killed run cannot leave a stale lock.
  # -t 0: if another run holds it, exit now rather than queue a second full run
  # behind it. lockf says so with status 75, which launchctl would show as a
  # failure; a run already under way is the opposite of one, so it becomes 0.
  if [ "${PRESSD_LOCKED:-0}" != 1 ]; then
    PRESSD_LOCKED=1 /usr/bin/lockf -s -t 0 "$base/.run.lock" /bin/bash "$0" "$@" || rc=$?
    [ "$rc" = 75 ] && rc=0
    return "$rc"
  fi

  clone="$base/ingest"
  ref="${PRESSD_DEPLOY_REF:-main}"
  stamp="$base/last_success"
  if [ "${1:-}" = "--catch-up" ]; then catch_up=1; shift; fi

  if [ "$catch_up" = 1 ]; then
    # Silent when there's nothing to do: this fires every 30 minutes, and a log
    # line each time would bury the runs that matter.
    sched=$(last_scheduled)
    [ "$(date +%s)" -lt $((sched + CATCHUP_GRACE_MIN * 60)) ] && return 0
    [ -f "$stamp" ] && [ "$(stat -f %m "$stamp")" -ge "$sched" ] && return 0
  fi

  if ! fully_awake; then
    # A dark wake: the lid is shut and macOS has woken for a few seconds of
    # upkeep. A run started now advances in those few-second bursts and
    # finishes whenever the lid next opens (Oct 6: started 00:30, done 23:13,
    # and audio-health went red at the 8h 'running' limit). Leave it to the
    # catch-up, which fires again once the Mac is properly awake.
    [ "$catch_up" = 1 ] || echo "[nightly] $(date '+%Y-%m-%d %H:%M:%S %Z'): asleep (dark wake); leaving tonight's run to the next catch-up"
    return 0
  fi

  if ! wait_for_network "$([ "$catch_up" = 1 ] && echo "$CATCHUP_NETWORK_WAIT_S" || echo "$NETWORK_WAIT_S")"; then
    # Asleep or offline — a dark wake, most likely. Not a failure: the next
    # catch-up does the run once the Mac is awake and online.
    echo "[nightly] $(date '+%Y-%m-%d %H:%M:%S %Z'): no network; leaving tonight's run to the next catch-up"
    return 0
  fi

  echo "=== nightly $(date '+%Y-%m-%d %H:%M:%S %Z') ref=$ref$([ "$catch_up" = 1 ] && echo ' (catch-up)') ==="

  if [ "${PRESSD_DEPLOY_PULL:-1}" = "1" ]; then
    # A failed fetch must not cost the night: run the code already here.
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
