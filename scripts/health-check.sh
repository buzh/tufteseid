#!/usr/bin/env bash
#
# Cron's half of the monitoring. Silent when the deployment is fine and noisy
# only when it is not, so a crontab line mails you exactly the problems:
#
#   */30 * * * * /site/tufteseid/scripts/health-check.sh
#
# Six questions, in the order that a failure in one explains the next: are the
# containers up, is the disk filling, is Caddy answering 5xx, is Kartverket
# shedding us, has nginx lost every peer, and does the app still work
# end-to-end. The last is live-check.sh, run whole rather than reimplemented —
# it already asks one question per service and its exit status is the verdict.
#
#   scripts/health-check.sh [base-url] [lokalitet-code]
#
# Runs on the server: everything but live-check.sh needs the host's log
# directory and the compose project. Writes nothing.

set -uo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

LOGDIR=${TUFTESEID_LOGS:-/site/tufteseid/data/logs}
HOURS=${HOURS:-1}

# Thresholds, not alarms — none of these is broken on its own, they are the
# points past which somebody should look. A handful of 5xx an hour is a
# Kartverket backend being restarted; fifty is a hole in the map. Any
# rate-limited response at all is worth knowing about, because $skip_cache_type
# keeps them out of the cache, so every one of them is a tile a visitor
# genuinely did not get.
DISK_PCT=${DISK_PCT:-90}
MAX_5XX=${MAX_5XX:-50}
MAX_SHED=${MAX_SHED:-1}

# Quiet unless something is wrong. VERBOSE=1 prints the passing lines too,
# which is what you want the first time you run it by hand.
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

# ------------------------------------------------------------------ services --

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

# ---------------------------------------------------------------------- disk --

# The one that takes the site down rather than degrading it: the cVAT store and
# the MapProxy caches share a filesystem, MapProxy never evicts, and a full
# disk stops PocketBase writing.
used=$(df --output=pcent "$(dirname -- "$LOGDIR")" 2>/dev/null | tail -1 | tr -dc '0-9')
if [ -z "$used" ]; then
  bad "cannot stat the filesystem holding $LOGDIR"
elif [ "$used" -ge "$DISK_PCT" ]; then
  bad "disk ${used}% full (threshold ${DISK_PCT}%) on $(dirname -- "$LOGDIR")"
else
  ok "disk ${used}% full"
fi

# --------------------------------------------------------------------- caddy --

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

# ------------------------------------------------------------------ wmscache --

wlog=$(dc logs --no-log-prefix --since "${HOURS}h" wmscache 2>/dev/null)

if [ -z "$wlog" ]; then
  ok 'no wmscache traffic in the window'
else
  # The 200 that is not a success: application/vnd.ogc.se_xml is the
  # "Overforbruk på kort tid" ServiceException wms.geonorge.no answers with
  # once we pass its per-IP budget. Invisible to any status-code count.
  shed=$(printf '%s\n' "$wlog" | grep -c 'ct=[^ ,]*se_xml')
  if [ "$shed" -ge "$MAX_SHED" ]; then
    bad "$shed × rate-limited by an upstream in ${HOURS}h — tiles were dropped"
  else
    ok 'no rate-limited responses'
  fi

  # nginx taking every peer in a group out at once. max_fails=0 in
  # wms-cache.conf exists to make this impossible, so if it appears the config
  # in the container is not the one in the repo. Found in the same capture:
  # `docker compose logs` carries the error log as well as the access log.
  if printf '%s\n' "$wlog" | grep -q 'no live upstreams'; then
    bad 'nginx logged "no live upstreams" — max_fails=0 is not in effect'
  else
    ok 'all upstream peers live'
  fi
fi

# ----------------------------------------------------------------- end-to-end --

# Captured rather than streamed: on a pass nobody wants 40 ok lines in a mail,
# and on a failure the whole run is the useful part.
if ! out=$("$ROOT/scripts/live-check.sh" "$@" 2>&1); then
  bad 'live-check.sh failed'
  printf '%s\n' "$out"
elif [ "$VERBOSE" = 1 ]; then
  printf '%s\n' "$out"
else
  ok 'live-check.sh passed'
fi

# ------------------------------------------------------------------- verdict --

[ "$problems" -eq 0 ] || printf '\n%d problem(s)\n' "$problems"
[ "$problems" -eq 0 ]
