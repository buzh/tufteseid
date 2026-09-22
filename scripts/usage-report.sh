#!/usr/bin/env bash
#
# What the deployment has been asked for, in three parts, because there are
# three different questions and no single log answers more than one of them:
#
#   Visitors   GoAccess over Caddy's access log — who came, from where, to
#              what. Written as one self-contained HTML file.
#   Traffic    the same log by path prefix — what the requests were actually
#              made of, which at a map site is mostly not pages.
#   Upstreams  wmscache's access log — how much of that reached Kartverket,
#              Riksantikvaren, Kulturminnesøk or NiB rather than being
#              answered from disk here. The cache verdict is recorded nowhere
#              else, so this is the only honest answer to "are we being rude".
#
#   scripts/usage-report.sh [report-dir]
#
# Runs on the server, unlike live-check.sh: it reads the Caddy log off the host
# filesystem and the wmscache log out of `docker compose logs`, and neither is
# reachable from anywhere else. Read-only with respect to the app — it writes
# one HTML file and a size stamp into the report directory and touches nothing
# the stack reads. GoAccess arrives as a throwaway container, so docker is the
# only dependency beyond what the stack already needs.

set -uo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

# Where the Caddyfile's `log` block writes, and where the report goes. Both
# under the same data root as the cVAT and MapProxy stores.
LOGDIR=${TUFTESEID_LOGS:-/site/tufteseid/data/logs}
REPORT=${1:-${TUFTESEID_STATS:-/site/tufteseid/data/stats}}

# The window for the printed sections. The HTML report deliberately ignores it
# and covers every line Caddy still has — GoAccess is the thing you open to ask
# "since when", so narrowing it there would be answering the question for you.
HOURS=${HOURS:-168}

# Pinned like every other image in the stack. Nothing here depends on the
# version beyond --log-format=CADDY existing, which it has since 1.6.
GOACCESS_IMAGE=${GOACCESS_IMAGE:-allinurl/goaccess:1.9.4}

if [ -t 1 ]; then
  RED=$'\e[31m' DIM=$'\e[2m' BOLD=$'\e[1m' OFF=$'\e[0m'
else
  RED='' DIM='' BOLD='' OFF=''
fi

section() { printf '\n%s%s%s\n' "$BOLD" "$1" "$OFF"; }
note() { printf '     %s%s%s\n' "$DIM" "$1" "$OFF"; }
warn() { printf '  %s%s%s\n' "$RED" "$1" "$OFF"; }

CUTOFF=$(( $(date +%s) - HOURS * 3600 ))

# Current log plus every rolled generation. Caddy gzips what it rolls, so both
# shapes have to be read; an unmatched glob stays literal, which `-f` rejects.
read_caddy() {
  local f
  for f in "$LOGDIR"/access.log "$LOGDIR"/access-*.log; do
    [ -f "$f" ] && cat -- "$f"
  done
  for f in "$LOGDIR"/access-*.log.gz; do
    [ -f "$f" ] && gzip -dc -- "$f"
  done
  return 0
}

printf '%sTufteseid usage%s  %s  last %sh\n' "$BOLD" "$OFF" "$LOGDIR" "$HOURS"

if [ -z "$(read_caddy | head -c1)" ]; then
  warn "no access log under $LOGDIR"
  note 'Caddy writes one only when the Caddyfile asks it to and'
  note '/var/log/caddy is bind-mounted — see docs/monitoring.md.'
  exit 1
fi

mkdir -p -- "$REPORT" || exit 1

# ------------------------------------------------------------------ visitors --

section 'Visitors'

# The proxy prefixes are dropped before GoAccess sees them. They are the great
# majority of the lines and none of them is a visit: one pan of the map is a
# screenful of /wms/ and /cache/, so leaving them in makes "top pages" a list
# of tile endpoints and buries the one number worth having. /assets/ stays —
# GoAccess sorts static requests into their own panel by extension, and
# dropping them would make the bandwidth total a fiction.
#
# --ignore-crawlers matters more here than it would on a busy site: against a
# handful of real visitors a week, an unfiltered count is mostly scanners.
#
# --anonymize-ip truncates the last octet. It costs the ability to tell two
# visitors on one /24 apart, which at this scale is a rounding error, and it
# means the report can be kept around without holding addresses.
read_caddy \
  | grep -v -e '"uri":"/wms/' -e '"uri":"/wfs/' -e '"uri":"/kms/' \
             -e '"uri":"/arcgis/' -e '"uri":"/cache/' -e '"uri":"/cvat/' \
             -e '"uri":"/pb/' \
  | docker run --rm -i -v "$REPORT:/report" "$GOACCESS_IMAGE" - \
      --log-format=CADDY \
      --ignore-crawlers \
      --anonymize-ip \
      --no-progress \
      --html-report-title='Tufteseid' \
      --output=/report/index.html
# The docker element specifically, not the pipeline's: `grep -v` exits 1 when
# it passes nothing through, which on a log that happens to hold only proxy
# requests would be reported as GoAccess failing.
rc=${PIPESTATUS[2]}

if [ "$rc" -ne 0 ]; then
  warn "goaccess exited $rc — no HTML written"
  note 'If it rejected the format, its built-in CADDY spec has drifted from'
  note 'the JSON Caddy writes; docs/monitoring.md has the explicit fallback.'
else
  note "report $REPORT/index.html"
fi

# Headline numbers computed here rather than scraped back out of GoAccess, so
# the window applies and so this still prints when the container fails.
read_caddy | awk -v cutoff="$CUTOFF" '
  {
    if (!match($0, /"ts":[0-9.]+/)) next
    if (substr($0, RSTART + 5, RLENGTH - 5) + 0 < cutoff) next
    uri = ""; ip = ""
    if (match($0, /"uri":"[^"]*"/))       uri = substr($0, RSTART + 7, RLENGTH - 8)
    if (match($0, /"client_ip":"[^"]*"/)) ip  = substr($0, RSTART + 13, RLENGTH - 14)
    # A page view is the app being opened: "/" or a lokalitet short link.
    # Everything else is the app doing its job, counted in Traffic below.
    if (uri == "/" || uri ~ /^\/l\//) { pages++; if (ip != "") seen[ip] = 1 }
    total++
  }
  END {
    for (k in seen) uniq++
    printf "     %d page views from %d addresses, %d requests in all\n",
      pages + 0, uniq + 0, total + 0
  }
'

# ------------------------------------------------------------------- traffic --

section 'Traffic by prefix'

read_caddy | awk -v cutoff="$CUTOFF" '
  {
    if (!match($0, /"ts":[0-9.]+/)) next
    if (substr($0, RSTART + 5, RLENGTH - 5) + 0 < cutoff) next
    uri = ""; st = 0; sz = 0
    if (match($0, /"uri":"[^"]*"/))   uri = substr($0, RSTART + 7, RLENGTH - 8)
    if (match($0, /"status":[0-9]+/)) st  = substr($0, RSTART + 9, RLENGTH - 9) + 0
    if (match($0, /"size":[0-9]+/))   sz  = substr($0, RSTART + 7, RLENGTH - 7) + 0

    q = index(uri, "?"); if (q) uri = substr(uri, 1, q - 1)
    n = split(uri, p, "/")
    key = (n >= 2 && p[2] != "") ? "/" p[2] : "/"
    # One more segment where the second one picks the upstream rather than
    # just naming a file — /wms/ra and /wms/geonorge are different services.
    if (key == "/wms" || key == "/arcgis" || key == "/wfs")
      key = key "/" (n >= 3 ? p[3] : "")

    tot[key]++; bytes[key] += sz
    if (st >= 500) err[key]++
  }
  END {
    for (k in tot)
      printf "  %-22s %8d  %7.1f MB  %s\n", k, tot[k], bytes[k] / 1048576,
        (err[k] ? err[k] " × 5xx" : "")
  }
' | sort -k2 -nr

# ----------------------------------------------------------------- upstreams --

section 'Upstream load (wmscache)'

# --no-log-prefix so the fields line up; the service name is in the header.
docker compose --project-directory "$ROOT" logs \
  --no-log-prefix --since "${HOURS}h" wmscache 2>/dev/null | awk '
  function host(u) {
    if (u ~ /^\/skwms1\//)           return "wms.geonorge.no"
    if (u ~ /^\/wfs-skwms1\//)       return "wfs.geonorge.no"
    if (u ~ /^\/wms\//)              return "kart.ra.no"
    if (u ~ /^\/kms-api\//)          return "kulturminnesok.no"
    if (u ~ /^\/nib-/)               return "norgeibilder.no"
    if (u ~ /^\/hoydedata-arcgis\//) return "hoydedata.no"
    return "other"
  }
  # Positional for the first five fields, which structurally cannot contain a
  # space, and regex for everything after them: proxy_next_upstream turns
  # $upstream_addr and $upstream_response_time into comma-and-space lists on a
  # retry, which shifts every later field. The regexes take the first value,
  # i.e. the first attempt.
  NF >= 5 && $3 != "" {
    h = host($5)
    lines++
    tot[h]++
    # HIT never leaves the container; UPDATING is a stale copy served while
    # some other request does the fetching. Everything else — MISS, EXPIRED,
    # REVALIDATED, STALE, BYPASS, and "-" on the uncached WFS location — means
    # the origin was asked.
    if ($3 != "HIT" && $3 != "UPDATING") origin[h]++
    if ($2 + 0 >= 500) err[h]++
    # A 200 carrying a ServiceException: the rate limit, not an error code.
    if ($0 ~ /ct=[^ ,]*se_xml/) shed[h]++
    if (match($0, /urt=[0-9.]+/)) { sum[h] += substr($0, RSTART + 4, RLENGTH - 4); n[h]++ }
  }
  END {
    if (!lines) { print "  (no lines — restart wmscache to pick up the log_format)"; exit }
    for (h in tot)
      printf "  %-22s %8d req  %5.1f%% cached  %7d to origin  %6.2fs  %s%s\n",
        h, tot[h], 100 * (tot[h] - origin[h]) / tot[h], origin[h] + 0,
        (n[h] ? sum[h] / n[h] : 0),
        (err[h] ? err[h] " × 5xx  " : ""),
        (shed[h] ? shed[h] " × rate-limited" : "")
  }
' | sort -k2 -nr

# -------------------------------------------------------------------- stores --

section 'Stores'

# MapProxy fetches from wms.geonorge.no directly, not through wmscache, so its
# outbound traffic does not appear in the section above and cannot be counted
# from any log we keep. Growth of its store is the proxy for it: MapProxy never
# evicts, so bytes added since the last run are bytes fetched since the last
# run. Same reading for the wmscache volume, which does evict at 25 GB and so
# plateaus rather than growing.
STAMP=$REPORT/.sizes
: >"$STAMP.new"

# KiB rather than bytes throughout: the wmscache figure comes from busybox du
# inside the nginx image, which has -s and -k but no -b.
size_of() {
  local label=$1 kib=$2 prev delta=''
  if [ -z "$kib" ]; then
    printf '  %-22s %s(unreadable)%s\n' "$label" "$DIM" "$OFF"
    return
  fi
  prev=$(awk -v l="$label" '$1 == l { print $2 }' "$STAMP" 2>/dev/null)
  [ -n "$prev" ] && delta=$(awk -v a="$kib" -v b="$prev" \
    'BEGIN { printf "%+.1f MB since last run", (a - b) / 1024 }')
  printf '%s %s\n' "$label" "$kib" >>"$STAMP.new"
  printf '  %-22s %8.2f GB   %s%s%s\n' "$label" \
    "$(awk -v k="$kib" 'BEGIN { print k / 1048576 }')" "$DIM" "$delta" "$OFF"
}

for store in cvat mapproxy logs; do
  dir=$(dirname -- "$LOGDIR")/$store
  [ -d "$dir" ] || continue
  size_of "$store" "$(du -sk -- "$dir" 2>/dev/null | cut -f1)"
done

size_of wmscache "$(docker compose --project-directory "$ROOT" exec -T wmscache \
  du -sk /var/cache/nginx/wms 2>/dev/null | cut -f1)"

mv -- "$STAMP.new" "$STAMP"

df -h --output=avail,pcent,target "$(dirname -- "$LOGDIR")" 2>/dev/null | tail -1 \
  | while read -r avail pcent target; do note "$avail free on $target ($pcent used)"; done
