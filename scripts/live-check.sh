#!/usr/bin/env bash
#
#   scripts/live-check.sh [base-url] [spot-code]
#
# The spot code is optional: given one, the PocketBase half fetches that public
# spot by code; without one it only asserts that the spots collection answers.
# Runs unauthenticated, so it sees what a guest sees.
#
# Read-only against production: the one POST exists to be refused.

set -uo pipefail

BASE=${1:-https://kart.scheen.no}
CODE=${2:-}
BASE=${BASE%/}
TIMEOUT=${TIMEOUT:-60}

# EPSG:25833, easting first: WMS 1.3.0 takes the CRS's own axis order, and
# swapping them answers 200 with a blank tile rather than an error.
BBOX=187045,6536056,187291,6536224
BBOX_WIDE=185000,6534000,189000,6538000
# The acquisition covering that box; the name needs URL-encoding.
LIDAR_PROJECT='NDH Kragerø-Drangedal 2pkt 2016'
# A record that exists: a miss also answers 200, with a null body.
KMS_ID=86050
# /l/<code> is a pure Caddy redir, so any code-shaped string exercises it.
SHORT_CODE=${CODE:-ABCDEF}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [ -t 1 ]; then
  RED=$'\e[31m' GREEN=$'\e[32m' DIM=$'\e[2m' BOLD=$'\e[1m' OFF=$'\e[0m'
else
  RED='' GREEN='' DIM='' BOLD='' OFF=''
fi

passed=0
failed=0
OPTS=(-s)

section() { printf '\n%s%s%s\n' "$BOLD" "$1" "$OFF"; }

note() { printf '     %s%s%s\n' "$DIM" "$1" "$OFF"; }

# For assertions made without a request of their own.
pass() {
  passed=$((passed + 1))
  printf '  %sok%s   %-26s %s%s%s\n' "$GREEN" "$OFF" "$1" "$DIM" "${2:-}" "$OFF"
}

fail() {
  failed=$((failed + 1))
  printf '  %sFAIL%s %-26s %s\n' "$RED" "$OFF" "$1" "${2:-}"
}

# check NAME URL WANT_STATUS CTYPE_SUBSTRING MIN_BYTES [BODY_REGEX] [HEADER_REGEX]
#
# CTYPE_SUBSTRING and the two regexes may be empty to skip that assertion.
# Extra curl arguments come from OPTS, which is reset after every call.
check() {
  local name=$1 url=$2 want=$3 ctype=$4 min=$5 body_re=${6:-} hdr_re=${7:-}
  local out status ct size secs cache rc why=''

  # A curl that never connects leaves no files behind; these are read anyway.
  : >"$TMP/body"
  : >"$TMP/hdr"

  out=$(curl -sS -o "$TMP/body" -D "$TMP/hdr" \
    -w '%{http_code}|%{content_type}|%{size_download}|%{time_total}' \
    --max-time "$TIMEOUT" "${OPTS[@]}" "$url" 2>"$TMP/err")
  rc=$?
  OPTS=(-s)

  IFS='|' read -r status ct size secs <<<"$out"
  # LC_ALL=C: curl writes a dot, printf in a Norwegian locale wants a comma.
  secs=$(LC_ALL=C printf '%.2f' "${secs:-0}")
  cache=$(grep -i '^x-cache-status:' "$TMP/hdr" | tr -d '\r' | awk '{print $2}')

  if [ $rc -ne 0 ]; then
    why="curl exit $rc: $(tr -d '\n' <"$TMP/err")"
  elif [ "$status" != "$want" ]; then
    why="status $status, want $want"
  elif [ -n "$ctype" ] && [[ $ct != *"$ctype"* ]]; then
    why="content-type $ct, want *$ctype*"
  elif [ "${size:-0}" -lt "$min" ]; then
    why="${size}B, want at least ${min}B"
  elif [ -n "$body_re" ] && ! grep -qE "$body_re" "$TMP/body"; then
    why="body does not match /$body_re/"
  elif [ -n "$hdr_re" ] && ! tr -d '\r' <"$TMP/hdr" | grep -qiE "$hdr_re"; then
    why="headers do not match /$hdr_re/"
  fi

  if [ -n "$why" ]; then
    fail "$name" "$why"
    printf '       %s%s%s\n' "$DIM" "$url" "$OFF"
  else
    passed=$((passed + 1))
    printf '  %sok%s   %-26s %s%8sB %6ss  %s%s\n' \
      "$GREEN" "$OFF" "$name" "$DIM" "$size" "$secs" "${cache:-}" "$OFF"
  fi
}

# PocketBase does not order its JSON keys, so match the key, not a position.
json_str() { grep -o "\"$1\":\"[^\"]*\"" "$TMP/body" | head -1 | sed "s/^\"$1\":\"//;s/\"$//"; }
json_num() { grep -o "\"$1\":[0-9]*" "$TMP/body" | head -1 | sed "s/^\"$1\"://"; }

urlenc() { printf '%s' "$1" | od -An -tx1 -v | tr -d '\n ' | sed 's/\(..\)/%\1/g'; }

printf '%sTufteseid live check%s  %s%s\n' "$BOLD" "$OFF" "$BASE" "${CODE:+  spot $CODE}"

section 'Shell'

check index "$BASE/" 200 text/html 300 'id="root"'
ENTRY=$(grep -o 'src="/assets/[^"]*\.js"' "$TMP/body" | head -1 | sed 's/^src="//;s/"$//')
note "entry bundle ${ENTRY:-none found}"

check csp-header "$BASE/" 200 text/html 300 '' "content-security-policy:.*default-src 'self'"
check config-js "$BASE/config.js" 200 javascript 50 '__TUFTESEID_CONFIG__'
if [ -n "$ENTRY" ]; then
  check entry-bundle "$BASE$ENTRY" 200 javascript 500
else
  fail entry-bundle 'index.html names no /assets/*.js'
fi
check short-link "$BASE/l/$SHORT_CODE" 302 '' 0 '' "location: /\?lok=$SHORT_CODE"
# 200 means a catch-all rewrite: every typo would answer with the app.
check unknown-path "$BASE/tufteseid-no-such-path" 404 '' 0

section 'PocketBase'

check pb-health "$BASE/pb/api/health" 200 json 20 'API is healthy'
check pb-auth-methods "$BASE/pb/api/collections/users/auth-methods" 200 json 20 '"password"'
note "oauth2: $(grep -o '"name":"[a-z0-9]*"' "$TMP/body" | sed 's/.*:"//;s/"//' | sort -u | paste -sd, -)"

# Unauthenticated, so the list is what the listRule shows a guest: the public
# spots. An empty one is a valid state, not a failure.
check spots-list "$BASE/pb/api/collections/spots/records?perPage=1&fields=id" \
  200 json 20 '"totalItems":'
PUBLIC=$(json_num totalItems)
note "${PUBLIC:-0} public spot(s) visible to a guest"

if [ -n "$CODE" ]; then
  # `fields` rather than the whole record: it keeps the 5 MB sketch out of the
  # response, and stops json_str picking up a second "id".
  check spot \
    "$BASE/pb/api/collections/spots/records?filter=$(urlenc "(code='$CODE')")&fields=id,code,name,credit,visibility,point" \
    200 json 20 '"totalItems":1'
  SPOT_ID=$(json_str id)

  if [ -n "$SPOT_ID" ]; then
    CREDIT=$(json_str credit)
    note "$(json_str name) · ${CREDIT:-no credit} · $(json_str visibility) · $SPOT_ID"

    # What the card and the pin read. `credit` and `description` may be empty.
    MISSING=''
    for FIELD in code name visibility; do
      grep -q "\"$FIELD\":\"[^\"]" "$TMP/body" || MISSING="$MISSING $FIELD"
    done
    grep -qE '"point":\[-?[0-9.]+,-?[0-9.]+\]' "$TMP/body" || MISSING="$MISSING point"

    if [ -n "$MISSING" ]; then
      fail spot-fields "empty or absent:$MISSING"
    else
      pass spot-fields 'code name visibility point'
    fi
  fi
fi

# To a file, not a pipe: the stream never ends, so curl always exits on
# --max-time, which under `pipefail` would sink the pipeline.
curl -sS -N --max-time 5 -o "$TMP/sse" "$BASE/pb/api/realtime" 2>/dev/null
if grep -q PB_CONNECT "$TMP/sse" 2>/dev/null; then
  pass pb-realtime PB_CONNECT
else
  fail pb-realtime 'no PB_CONNECT event (SSE buffered? flush_interval)'
fi

# `users` is closed to guests, so a non-empty expand here means somebody
# opened it. Needs a readable record to expand from.
if [ "${PUBLIC:-0}" -gt 0 ]; then
  check owner-not-expanded \
    "$BASE/pb/api/collections/spots/records?perPage=1&expand=owner&fields=expand.owner.name" \
    200 json 20 '"expand":\{\}'
fi

check no-private-leak \
  "$BASE/pb/api/collections/spots/records?filter=%28visibility%21%3D%27public%27%29&perPage=1&fields=id" \
  200 json 20 '"totalItems":0'

# 400, not 403: createRule is set, so PocketBase validates the payload before
# it refuses the guest.
OPTS=(-s -X POST -H 'Content-Type: application/json' -d '{"name":"live-check"}')
check anon-write-refused "$BASE/pb/api/collections/spots/records" 400 json 10

section 'Same-origin upstreams (Caddy → wmscache → origin)'

check wms-topo \
  "$BASE/wms/geonorge/wms.topo?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=kd_veger,kd_stedsnavn&STYLES=&CRS=EPSG:25833&BBOX=$BBOX_WIDE&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=true" \
  200 image/png 1000

check wms-lidar-national \
  "$BASE/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=NHM_DTM_TopoBathy_25833:skyggerelieff&STYLES=&CRS=EPSG:25833&BBOX=$BBOX&WIDTH=256&HEIGHT=256&FORMAT=image/png" \
  200 image/png 5000

check wms-lidar-project \
  "$BASE/wms/geonorge/wms.hoyde-dtm-prosjekt?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=$(urlenc "$LIDAR_PROJECT")&STYLES=skyggerelieff&CRS=EPSG:25833&BBOX=$BBOX&WIDTH=256&HEIGHT=256&FORMAT=image/png" \
  200 image/png 5000

# The dataset picker's whole catalogue, ~8 MB.
check wms-lidar-capabilities \
  "$BASE/wms/geonorge/wms.hoyde-dtm-prosjekt?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0" \
  200 xml 1000000 '<Name>NDH'

check wfs-footprints \
  "$BASE/wfs/geonorge/wfs.hoyde-hoydedata-metadata-prosjekt?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=metadata_prosjekt:Prosjektavgrensning&OUTPUTFORMAT=geojson&COUNT=1&STARTINDEX=0&SRSNAME=urn:ogc:def:crs:EPSG::25833" \
  200 json 500 'FeatureCollection'

# STYLES is not optional on Riksantikvaren's MapServer 8: omitting it answers
# a ServiceException with HTTP 200.
check wms-kulturminner \
  "$BASE/wms/ra/kulturminner2?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Kulturminner&STYLES=&CRS=EPSG:25833&BBOX=$BBOX_WIDE&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=true" \
  200 image/png 1000

check kms-record "$BASE/kms/api/v2/search/$KMS_ID" 200 json 500 '"name":"[^"]'

# An expired or IP-bound token answers with a small JSON error, which the size
# floor catches.
check nib-ortofoto \
  "$BASE/wms/nib/ortofoto?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ortofoto&STYLES=&CRS=EPSG:25833&BBOX=$BBOX&WIDTH=256&HEIGHT=256&FORMAT=image/png" \
  200 image/png 10000

# Not `returnCountOnly`: that answer is under the 300-byte floor in
# `$skip_cache`, so it never caches and reads as a permanent MISS.
check nib-prosjekter \
  "$BASE/arcgis/nib/prosjekter/MapServer/4/query?f=json&where=1%3D1&geometry=$BBOX&geometryType=esriGeometryEnvelope&inSR=25833&spatialRel=esriSpatialRelIntersects&outFields=prosjektnavn,aar,fotodato_date,ortofototype,pixelstorrelse,x_min,y_min,x_max,y_max&returnGeometry=false" \
  200 json 500 '"prosjektnavn":"[^"]'

check hoydedata-dem \
  "$BASE/arcgis/hoydedata/Prosjekt_DTM/ImageServer/exportImage?f=image&format=tiff&bbox=$BBOX&bboxSR=25833&imageSR=25833&size=256,256&renderingRule=%7B%22rasterFunction%22%3A%22None%22%7D" \
  200 image/tiff 50000

section 'Direct upstreams (browser → origin, no proxy)'

check kv-cache-wmts 'https://cache.kartverket.no/v1/service?Request=GetCapabilities&Service=WMTS' \
  200 xml 10000 'topograatone'
check geonorge-stedsnavn 'https://ws.geonorge.no/stedsnavn/v1/navn?sok=L%C3%B8kstad&treffPerSide=1&side=1' \
  200 json 100 'totaltAntallTreff'
check geonorge-adresser 'https://ws.geonorge.no/adresser/v1/sok?sok=Karl%20Johans%20gate%201&treffPerSide=1' \
  200 json 100 'adresser'
check norgeskart-matrikkel 'https://api.norgeskart.no/v1/matrikkel/veg/Karl%20Johans%20gate' \
  200 json 100 'KOMMUNENAVN'
check hoydedata-identify \
  'https://hoydedata.no/arcgis/rest/services/NHM_DTM_TOPOBATHY_25833/ImageServer/identify?f=json&geometry=187168,6536140&geometryType=esriGeometryPoint&sr=25833&returnGeometry=false&returnCatalogItems=false' \
  200 json 100 '"value":"[0-9]'

printf '\n%s%d passed, %d failed%s\n' "$BOLD" "$passed" "$failed" "$OFF"
[ "$failed" -eq 0 ]
