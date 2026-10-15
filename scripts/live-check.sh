#!/usr/bin/env bash

set -uo pipefail

BASE=${1:-https://tufteseid.no}
CODE=${2:-}
BASE=${BASE%/}
TIMEOUT=${TIMEOUT:-60}

BBOX=187045,6536056,187291,6536224
BBOX_WIDE=185000,6534000,189000,6538000
LIDAR_PROJECT='NDH Kragerø-Drangedal 2pkt 2016'
KMS_ID=86050
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

skip() { printf '  %s--   %-26s %s%s\n' "$DIM" "$1" "${2:-}" "$OFF"; }

pass() {
  passed=$((passed + 1))
  printf '  %sok%s   %-26s %s%s%s\n' "$GREEN" "$OFF" "$1" "$DIM" "${2:-}" "$OFF"
}

fail() {
  failed=$((failed + 1))
  printf '  %sFAIL%s %-26s %s\n' "$RED" "$OFF" "$1" "${2:-}"
}

check() {
  local name=$1 url=$2 want=$3 ctype=$4 min=$5 body_re=${6:-} hdr_re=${7:-}
  local out status ct size secs cache rc why=''

  : >"$TMP/body"
  : >"$TMP/hdr"

  out=$(curl -sS -o "$TMP/body" -D "$TMP/hdr" \
    -w '%{http_code}|%{content_type}|%{size_download}|%{time_total}' \
    --max-time "$TIMEOUT" "${OPTS[@]}" "$url" 2>"$TMP/err")
  rc=$?
  OPTS=(-s)

  IFS='|' read -r status ct size secs <<<"$out"
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

check services-js "$BASE/services.js" 200 javascript 50 '__TUFTESEID_SERVICES__'
SERVICES=$(cat "$TMP/body")
printf '%s' "$SERVICES" | grep -q '__TUFTESEID_SERVICES__' || SERVICES=''
on() { [ -z "$SERVICES" ] || printf '%s' "$SERVICES" | grep -q "$1: *true"; }
if [ -z "$SERVICES" ]; then
  note 'services.js unreadable — every sidecar checked below'
else
  note "$(printf '%s' "$SERVICES" | grep -o '[a-z]*: *true' | sed 's/: *true//' |
    paste -sd, - | sed 's/^$/none/') enabled"
fi
if [ -n "$ENTRY" ]; then
  check entry-bundle "$BASE$ENTRY" 200 javascript 500
else
  fail entry-bundle 'index.html names no /assets/*.js'
fi
check short-link "$BASE/l/$SHORT_CODE" 302 '' 0 '' "location: /\?lok=$SHORT_CODE"
check unknown-path "$BASE/tufteseid-no-such-path" 404 '' 0

section 'PocketBase'

check pb-health "$BASE/pb/api/health" 200 json 20 'API is healthy'
check pb-auth-methods "$BASE/pb/api/collections/users/auth-methods" 200 json 20 '"password"'
note "oauth2: $(grep -o '"name":"[a-z0-9]*"' "$TMP/body" | sed 's/.*:"//;s/"//' | sort -u | paste -sd, -)"

check spots-list "$BASE/pb/api/collections/spots/records?perPage=1&fields=id" \
  200 json 20 '"totalItems":'
PUBLIC=$(json_num totalItems)
note "${PUBLIC:-0} public spot(s) visible to a guest"

if [ -n "$CODE" ]; then
  check spot \
    "$BASE/pb/api/collections/spots/records?filter=$(urlenc "(code='$CODE')")&fields=id,code,name,credit,visibility,point" \
    200 json 20 '"totalItems":1'
  SPOT_ID=$(json_str id)

  if [ -n "$SPOT_ID" ]; then
    CREDIT=$(json_str credit)
    note "$(json_str name) · ${CREDIT:-no credit} · $(json_str visibility) · $SPOT_ID"

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

curl -sS -N --max-time 5 -o "$TMP/sse" "$BASE/pb/api/realtime" 2>/dev/null
if grep -q PB_CONNECT "$TMP/sse" 2>/dev/null; then
  pass pb-realtime PB_CONNECT
else
  fail pb-realtime 'no PB_CONNECT event (SSE buffered? flush_interval)'
fi

if [ "${PUBLIC:-0}" -gt 0 ]; then
  check owner-not-expanded \
    "$BASE/pb/api/collections/spots/records?perPage=1&expand=owner&fields=expand.owner.name" \
    200 json 20 '"expand":\{\}'
fi

check no-private-leak \
  "$BASE/pb/api/collections/spots/records?filter=%28visibility%21%3D%27public%27%29&perPage=1&fields=id" \
  200 json 20 '"totalItems":0'

OPTS=(-s -X POST -H 'Content-Type: application/json' -d '{"name":"live-check"}')
check anon-write-refused "$BASE/pb/api/collections/spots/records" 400 json 10

check scores-open "$BASE/pb/api/collections/spotScores/records?perPage=1&fields=spot,score" \
  200 json 20 '"totalItems":'
note "$(json_num totalItems) spot(s) with a tally"

check votes-hidden "$BASE/pb/api/collections/votes/records?perPage=1&fields=id" \
  200 json 20 '"totalItems":0'

section 'Identity'

check auth-methods "$BASE/pb/api/collections/users/auth-methods" \
  200 json 20 '"password":\{[^}]*"enabled":true'
check auth-no-oauth2 "$BASE/pb/api/collections/users/auth-methods" \
  200 json 20 '"oauth2":\{[^}]*"providers":\[\][^}]*"enabled":false'

check registration-gate "$BASE/pb/api/collections/registration/records?perPage=1" \
  200 json 20 '"openSlots"'

check user-cap "$BASE/pb/api/capacity" 200 json 10 '"max":'
note "$(json_num users) account(s) seated, cap $(json_num max)"

check invites-hidden "$BASE/pb/api/collections/invites/records?perPage=1&fields=id" \
  200 json 20 '"totalItems":0'

section 'Render sidecar'

if ! on render; then
  skip rendersvc 'ENABLE_RENDER is off'
else
  check render-health "$BASE/render/health" 200 json 10 '"ok":true'
  note "queue $(json_num pending) of $(json_num capacity)"

  OPTS=(-s -X POST -H 'Content-Type: application/json' -d '{"evidence":"livecheck"}')
  check render-anon-refused "$BASE/render/sunloop" 401 json 10
fi

section 'Same-origin upstreams (Caddy → wmscache → origin)'

check wms-topo \
  "$BASE/wms/geonorge/wms.topo?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=kd_veger,kd_stedsnavn&STYLES=&CRS=EPSG:25833&BBOX=$BBOX_WIDE&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=true" \
  200 image/png 1000

check wms-lidar-national \
  "$BASE/wms/geonorge/wms.hoyde-dtm-nhm-25833?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=NHM_DTM_25833:skyggerelieff&STYLES=&CRS=EPSG:25833&BBOX=$BBOX&WIDTH=256&HEIGHT=256&FORMAT=image/png" \
  200 image/png 5000

check wms-lidar-project \
  "$BASE/wms/geonorge/wms.hoyde-dtm-prosjekt?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=$(urlenc "$LIDAR_PROJECT")&STYLES=skyggerelieff&CRS=EPSG:25833&BBOX=$BBOX&WIDTH=256&HEIGHT=256&FORMAT=image/png" \
  200 image/png 5000

check wms-lidar-capabilities \
  "$BASE/wms/geonorge/wms.hoyde-dtm-prosjekt?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0" \
  200 xml 1000000 '<Name>NDH'

check wfs-footprints \
  "$BASE/wfs/geonorge/wfs.hoyde-hoydedata-metadata-prosjekt?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=metadata_prosjekt:Prosjektavgrensning&OUTPUTFORMAT=geojson&COUNT=1&STARTINDEX=0&SRSNAME=urn:ogc:def:crs:EPSG::25833" \
  200 json 500 'FeatureCollection'

check wms-kulturminner \
  "$BASE/wms/ra/kulturminner2?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Kulturminner&STYLES=&CRS=EPSG:25833&BBOX=$BBOX_WIDE&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=true" \
  200 image/png 1000

check kms-record "$BASE/kms/api/v2/search/$KMS_ID" 200 json 500 '"name":"[^"]'

if ! on flyfoto; then
  skip nib-proxy 'ENABLE_FLYFOTO is off'
else
  check nib-anon-refused \
    "$BASE/wms/nib/ortofoto?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ortofoto&STYLES=&CRS=EPSG:25833&BBOX=$BBOX&WIDTH=256&HEIGHT=256&FORMAT=image/png" \
    401 '' 0

  check nib-cache-anon-refused "$BASE/cache/flyfoto/14/8802/4703.jpeg" 401 '' 0

  if [ -z "${NIB_TOKEN:-}" ]; then
    skip nib-ortofoto 'set NIB_TOKEN to a token held by a flyfoto account'
    skip nib-prosjekter 'set NIB_TOKEN to a token held by a flyfoto account'
  else
    OPTS=(-s -H "Cookie: nib_auth=$NIB_TOKEN")
    check nib-ortofoto \
      "$BASE/wms/nib/ortofoto?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ortofoto&STYLES=&CRS=EPSG:25833&BBOX=$BBOX&WIDTH=256&HEIGHT=256&FORMAT=image/png" \
      200 image/png 10000

    OPTS=(-s -H "Cookie: nib_auth=$NIB_TOKEN")
    check nib-prosjekter \
      "$BASE/arcgis/nib/prosjekter/MapServer/4/query?f=json&where=1%3D1&geometry=$BBOX&geometryType=esriGeometryEnvelope&inSR=25833&spatialRel=esriSpatialRelIntersects&outFields=prosjektnavn,aar,fotodato_date,ortofototype,pixelstorrelse,x_min,y_min,x_max,y_max&returnGeometry=false" \
      200 json 500 '"prosjektnavn":"[^"]'
  fi
fi

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

printf '\n%s%d passed, %d failed%s\n' "$BOLD" "$passed" "$failed" "$OFF"
[ "$failed" -eq 0 ]
