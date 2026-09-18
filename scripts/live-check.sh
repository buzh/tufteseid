#!/usr/bin/env bash
#
# Liveness pass over a deployed Tufteseid. Every request below is one the app
# itself makes; a red line names the service that is down, not a symptom.
#
#   scripts/live-check.sh [base-url] [lokalitet-code]
#
# Defaults are the reference deployment and its shared lokalitet. curl is the
# only dependency. Safe against production: nothing here writes, and the one
# POST exists to be refused.
#
# The procedure this is half of — and what each failure means — is
# docs/live-site-test.md.

set -uo pipefail

BASE=${1:-https://kart.scheen.no}
CODE=${2:-JYBNQC}
BASE=${BASE%/}
TIMEOUT=${TIMEOUT:-60}

# A 250 m box over the fixture, EPSG:25833, easting first (WMS 1.3.0 takes the
# CRS's own axis order, and for 25833 that is E,N — swapping them answers 200
# with a blank tile rather than an error). Hardcoded rather than reprojected
# from the lokalitet's bbox: a raster liveness check does not care where it
# looks as long as the place has LiDAR and ortofoto coverage, and reprojecting
# would cost a dependency.
BBOX=187045,6536056,187291,6536224
BBOX_WIDE=185000,6534000,189000,6538000
# The acquisition covering that box. Names carry spaces and Norwegian letters.
LIDAR_PROJECT='NDH Kragerø-Drangedal 2pkt 2016'
# A Kulturminnesøk record that exists, so a 200 with an all-null body is a
# failure rather than the usual answer for a miss.
KMS_ID=86050

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

# check NAME URL WANT_STATUS CTYPE_SUBSTRING MIN_BYTES [BODY_REGEX] [HEADER_REGEX]
#
# CTYPE_SUBSTRING and the two regexes may be empty to skip that assertion.
# Extra curl arguments come from OPTS, which is reset after every call so a
# one-off -X POST cannot leak into the next check.
check() {
  local name=$1 url=$2 want=$3 ctype=$4 min=$5 body_re=${6:-} hdr_re=${7:-}
  local out status ct size secs cache rc why=''

  # A curl that never connects leaves no files behind, and the callers below
  # read them whatever the verdict was.
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
    failed=$((failed + 1))
    printf '  %sFAIL%s %-26s %s\n' "$RED" "$OFF" "$name" "$why"
    printf '       %s%s%s\n' "$DIM" "$url" "$OFF"
  else
    passed=$((passed + 1))
    printf '  %sok%s   %-26s %s%8sB %6ss  %s%s\n' \
      "$GREEN" "$OFF" "$name" "$DIM" "$size" "$secs" "${cache:-}" "$OFF"
  fi
}

# First "key":"value" out of a PocketBase response. PB does not order its JSON
# keys, so match the key rather than a position.
json_str() { grep -o "\"$1\":\"[^\"]*\"" "$TMP/body" | head -1 | sed "s/^\"$1\":\"//;s/\"$//"; }
json_num() { grep -o "\"$1\":[0-9]*" "$TMP/body" | head -1 | sed "s/^\"$1\"://"; }

urlenc() { printf '%s' "$1" | od -An -tx1 -v | tr -d '\n ' | sed 's/\(..\)/%\1/g'; }

printf '%sTufteseid live check%s  %s  lokalitet %s\n' "$BOLD" "$OFF" "$BASE" "$CODE"

# ---------------------------------------------------------------- the shell --

section 'Shell'

check index "$BASE/" 200 text/html 300 'id="root"'
ENTRY=$(grep -o 'src="/assets/[^"]*\.js"' "$TMP/body" | head -1 | sed 's/^src="//;s/"$//')
note "entry bundle ${ENTRY:-none found}"

check csp-header "$BASE/" 200 text/html 300 '' "content-security-policy:.*default-src 'self'"
check config-js "$BASE/config.js" 200 javascript 50 '__NK_CONFIG__'
if [ -n "$ENTRY" ]; then
  check entry-bundle "$BASE$ENTRY" 200 javascript 500
else
  failed=$((failed + 1))
  printf '  %sFAIL%s %-26s index.html names no /assets/*.js\n' "$RED" "$OFF" entry-bundle
fi
check short-link "$BASE/l/$CODE" 302 '' 0 '' "location: /\?lok=$CODE"
# 404 on purpose: `file_server` has no SPA fallback, so a wrong path stays
# wrong. There is no client-side routing left to need one — `/` is the only
# path the app answers on. A 200 here means somebody added a catch-all rewrite
# and every typo now answers with the app.
check unknown-path "$BASE/tufteseid-no-such-path" 404 '' 0

# ----------------------------------------------------------------- pocketbase --

section 'PocketBase'

check pb-health "$BASE/pb/api/health" 200 json 20 'API is healthy'
check pb-auth-methods "$BASE/pb/api/collections/users/auth-methods" 200 json 20 '"password"'
note "oauth2: $(grep -o '"name":"[a-z0-9]*"' "$TMP/body" | sed 's/.*:"//;s/"//' | sort -u | paste -sd, -)"

# `fields` rather than the whole record: PocketBase does not order its JSON
# keys, and an expanded relation would put a second "id" in the body for
# json_str to pick up.
check lokalitet \
  "$BASE/pb/api/collections/localities/records?filter=%28code%3D%27$CODE%27%29&fields=id,code,name,municipality,visibility" \
  200 json 20 '"totalItems":1'
LOK_ID=$(json_str id)

if [ -n "$LOK_ID" ]; then
  note "$(json_str name) · $(json_str municipality) · $(json_str visibility) · $LOK_ID"
  FILTER=$(urlenc "(locality='$LOK_ID')")

  check funn "$BASE/pb/api/collections/finds/records?filter=$FILTER&perPage=1&fields=id" 200 json 20
  note "$(json_num totalItems) funn"

  check bilder "$BASE/pb/api/collections/attachments/records?filter=$FILTER&perPage=1&fields=id,collectionId,file" \
    200 json 20
  note "$(json_num totalItems) bilder"
  ATT_ID=$(json_str id)
  ATT_COL=$(json_str collectionId)
  ATT_FILE=$(json_str file)

  if [ -n "$ATT_FILE" ]; then
    check bilde-fil "$BASE/pb/api/files/$ATT_COL/$ATT_ID/$ATT_FILE" 200 image 10000
    check bilde-thumb "$BASE/pb/api/files/$ATT_COL/$ATT_ID/$ATT_FILE?thumb=100x100" 200 image 500
  fi
fi

# The rail and the funn list update live; without this they only fill in on a
# reload, which reads as "my funn did not save". Read to a file rather than
# through a pipe: the stream never ends, so curl always exits on --max-time and
# under `pipefail` that would sink the whole pipeline.
curl -sS -N --max-time 5 -o "$TMP/sse" "$BASE/pb/api/realtime" 2>/dev/null
if grep -q PB_CONNECT "$TMP/sse" 2>/dev/null; then
  passed=$((passed + 1))
  printf '  %sok%s   %-26s %sPB_CONNECT%s\n' "$GREEN" "$OFF" pb-realtime "$DIM" "$OFF"
else
  failed=$((failed + 1))
  printf '  %sFAIL%s %-26s no PB_CONNECT event (SSE buffered? flush_interval)\n' "$RED" "$OFF" pb-realtime
fi

# `users` was not opened to guests by migration 1700000900, so `expand=owner`
# comes back empty and the surfaces that name an owner — the *Delt av* banner,
# Detaljer's owner row, the report package's credit — have no name to print for
# a signed-out reader. Asserted rather than wished away: a non-empty expand here
# means the users collection has been opened up, which is a privacy decision.
check owner-not-expanded \
  "$BASE/pb/api/collections/localities/records?filter=%28code%3D%27$CODE%27%29&expand=owner&fields=expand.owner.name" \
  200 json 20 '"expand":\{\}'

# The list rule is the whole privacy model: an anonymous reader may see public
# records and nothing else.
check no-private-leak \
  "$BASE/pb/api/collections/localities/records?filter=%28visibility%21%3D%27public%27%29&perPage=1&fields=id" \
  200 json 20 '"totalItems":0'

# Refused by the create rule, not by the absence of a form.
OPTS=(-s -X POST -H 'Content-Type: application/json' -d '{"title":"live-check"}')
check anon-write-refused "$BASE/pb/api/collections/finds/records" 400 json 10

# ------------------------------------------------------- same-origin upstreams --

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

# The dataset picker's whole catalogue, ~8 MB. The one check here that is
# heavy, and the one whose absence empties the LiDAR pulldown.
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

# Both NiB checks also test the token sidecar: an expired or IP-bound token
# comes back as a small JSON error, which the size floor catches.
check nib-ortofoto \
  "$BASE/wms/nib/ortofoto?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ortofoto&STYLES=&CRS=EPSG:25833&BBOX=$BBOX&WIDTH=256&HEIGHT=256&FORMAT=image/png" \
  200 image/png 10000

# The acquisition catalogue over the probe box, in the shape flyfotoProjects.ts
# asks for — a `returnCountOnly` answer would be under the 300-byte floor in
# `$skip_cache` and so never cache, which reads as a permanent MISS.
check nib-prosjekter \
  "$BASE/arcgis/nib/prosjekter/MapServer/4/query?f=json&where=1%3D1&geometry=$BBOX&geometryType=esriGeometryEnvelope&inSR=25833&spatialRel=esriSpatialRelIntersects&outFields=prosjektnavn,aar,fotodato_date,ortofototype,pixelstorrelse,x_min,y_min,x_max,y_max&returnGeometry=false" \
  200 json 500 '"prosjektnavn":"[^"]'

check hoydedata-dem \
  "$BASE/arcgis/hoydedata/Prosjekt_DTM/ImageServer/exportImage?f=image&format=tiff&bbox=$BBOX&bboxSR=25833&imageSR=25833&size=256,256&renderingRule=%7B%22rasterFunction%22%3A%22None%22%7D" \
  200 image/tiff 50000

# ------------------------------------------------------------ direct upstreams --

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

# --------------------------------------------------------------------- verdict --

printf '\n%s%d passed, %d failed%s\n' "$BOLD" "$passed" "$failed" "$OFF"
[ "$failed" -eq 0 ]
