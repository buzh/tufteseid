#!/usr/bin/env bash
#
#   scripts/health-check.sh [base-url] [lokalitet-code]
#   */30 * * * * /site/tufteseid/scripts/health-check.sh
#
# Server-only: needs the host's log directory and the compose project. Silent
# unless something is wrong, so cron mails only the problems.

set -uo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

LOGDIR=${TUFTESEID_LOGS:-/site/tufteseid/data/logs}
HOURS=${HOURS:-1}

# A rate-limited response counts from the first: $skip_cache_type keeps them
# out of the cache, so each one is a tile a visitor did not get.
DISK_PCT=${DISK_PCT:-90}
MAX_5XX=${MAX_5XX:-50}
MAX_SHED=${MAX_SHED:-1}

VERBOSE=${VERBOSE:-0}

problems=0
CUTOFF=$(( $(date +%s) - HOURS * 3600 ))

bad() { problems=$((problems + 1)); printf 'PROBLEM  %s\n' "$1"; }
ok() { [ "$VERBOSE" = 1 ] && printf 'ok       %s\n' "$1"; return 0; }

dc() { docker compose --project-directory "$ROOT" "$@"; }

read_caddy() {
  local f
  for f in "$LOGDIR"/access.log "$LOGDIR"/access-*.log; do
    [ -f "$f" ] && cat -- "$f"
  done
  return 0
}

want=$(dc ps --services 2>/dev/null | sort)
have=$(dc ps --services --filter status=running 2>/dev/null | sort)

if [ -z "$want" ]; then
  bad 'docker compose knows no services here — wrong directory, or the daemon is down'
else
  down=$(comm -23 <(printf '%s\n' "$want") <(printf '%s\n' "$have"))
  if [ -n "$down" ]; then
    bad "not running: $(printf '%s' "$down" | paste -sd' ' -)"
  else
    ok "$(printf '%s\n' "$want" | wc -l) services running"
  fi
fi

# The cVAT store and the MapProxy caches share this filesystem, MapProxy never
# evicts, and a full disk stops PocketBase writing.
used=$(df --output=pcent "$(dirname -- "$LOGDIR")" 2>/dev/null | tail -1 | tr -dc '0-9')
if [ -z "$used" ]; then
  bad "cannot stat the filesystem holding $LOGDIR"
elif [ "$used" -ge "$DISK_PCT" ]; then
  bad "disk ${used}% full (threshold ${DISK_PCT}%) on $(dirname -- "$LOGDIR")"
else
  ok "disk ${used}% full"
fi

if [ -z "$(read_caddy | head -c1)" ]; then
  bad "no access log under $LOGDIR — the Caddyfile's log block or its bind mount is missing"
else
  n5xx=$(read_caddy | awk -v cutoff="$CUTOFF" '
    match($0, /"ts":[0-9.]+/) && substr($0, RSTART + 5, RLENGTH - 5) + 0 >= cutoff &&
    match($0, /"status":[0-9]+/) && substr($0, RSTART + 9, RLENGTH - 9) + 0 >= 500 { n++ }
    END { print n + 0 }
  ')
  if [ "$n5xx" -ge "$MAX_5XX" ]; then
    bad "$n5xx × 5xx from Caddy in ${HOURS}h (threshold $MAX_5XX)"
  else
    ok "$n5xx × 5xx from Caddy in ${HOURS}h"
  fi
fi

wlog=$(dc logs --no-log-prefix --since "${HOURS}h" wmscache 2>/dev/null)

if [ -z "$wlog" ]; then
  ok 'no wmscache traffic in the window'
else
  # application/vnd.ogc.se_xml is the ServiceException wms.geonorge.no answers
  # with, at HTTP 200, past its per-IP budget. No status code shows it.
  shed=$(printf '%s\n' "$wlog" | grep -c 'ct=[^ ,]*se_xml')
  if [ "$shed" -ge "$MAX_SHED" ]; then
    bad "$shed × rate-limited by an upstream in ${HOURS}h — tiles were dropped"
  else
    ok 'no rate-limited responses'
  fi

  # max_fails=0 in wms-cache.conf makes this impossible, so it appearing means
  # the container is not running the repo's config.
  if printf '%s\n' "$wlog" | grep -q 'no live upstreams'; then
    bad 'nginx logged "no live upstreams" — max_fails=0 is not in effect'
  else
    ok 'all upstream peers live'
  fi
fi

# Captured rather than streamed, so a passing run mails nothing.
if ! out=$("$ROOT/scripts/live-check.sh" "$@" 2>&1); then
  bad 'live-check.sh failed'
  printf '%s\n' "$out"
elif [ "$VERBOSE" = 1 ]; then
  printf '%s\n' "$out"
else
  ok 'live-check.sh passed'
fi

[ "$problems" -eq 0 ] || printf '\n%d problem(s)\n' "$problems"
[ "$problems" -eq 0 ]
