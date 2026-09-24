# WMS proxying, caching and tile loading

Read before touching `Caddyfile`, `nginx/`, `mapproxy/`, `nib-proxy/`,
`src/upstream/`, `src/map/layers/wmsTileGrid.ts`, or before adding an external
map source. What is drawn with these is `docs/map-layers.md`.

## Topology

Two independent chains plus two sidecars, all behind Caddy (`tufteseid`
container, `:3000`; host `127.0.0.1:3030`):

- `Browser → Caddy → wmscache → upstream` — every WMS/WFS/ArcGIS service whose
  parameters are chosen at request time, plus the Kulturminnesøk record API.
- `Browser → Caddy → mapproxy → upstream` — the six layers whose request never
  varies, meta-tiled onto the app's grid and held in MBTiles. wmscache is not
  in this path.
- `Browser → Caddy → cvat-tiles` — our own MBTiles, read off disk.
- `nib-proxy` — token-injecting sidecar for Norge i bilder, reached only from
  wmscache and mapproxy on the compose network. Never exposed.

## Routes

Caddy strips the same-origin prefix and rewrites into an internal namespace;
wmscache rewrites that into the upstream's own path. The internal aliases differ
so namespaces cannot collide inside nginx (WFS would want the WMS host's
`/skwms1/`; both ArcGIS upstreams would want `/arcgis/`).

| Same-origin prefix | Internal (nginx) | Upstream |
|---|---|---|
| `/wms/geonorge/wms.foo` | `/skwms1/` | `wms.geonorge.no/skwms1/wms.foo` |
| `/wfs/geonorge/wfs.foo` | `/wfs-skwms1/` | `wfs.geonorge.no/skwms1/wfs.foo` |
| `/wms/ra/kulturminner2` | `/wms/` | `kart.ra.no/wms/kulturminner2` |
| `/kms/api/v2/search/123` | `/kms-api/` | `kms-api.kulturminnesok.no/api/v2/search/123` |
| `/wms/nib/ortofoto` | `/nib-wms/` | nib-proxy → `services.norgeibilder.no/wms/ortofoto` |
| `/arcgis/nib/*` | `/nib-arcgis/` | nib-proxy → `services.norgeibilder.no/arcgis/rest/services/*` |
| `/arcgis/hoydedata/*` | `/hoydedata-arcgis/` | `hoydedata.no/arcgis/rest/services/*` |

Non-map routes: `/pb/*` → `pocketbase:8090`; `/cvat/*` → `cvat-tiles:8080`;
`/l/<code>` → `redir /?lok=<code>`. `file_server` has no SPA fallback, so any
other unknown path 404s.

## MapProxy (`/cache/*`)

`/cache/<layer>/<z>/<x>/<y>.<png|jpeg>`. One Caddy block covers every layer: a
`path_regexp` lifts the layer name out and substitutes it into
`/mapproxy/tiles/<layer>/tufteseid25833/…`, so a new layer needs no Caddy
change. A name MapProxy does not publish 404s from MapProxy.

| `/cache/` layer | Format | `meta_size` / `meta_buffer` | Upstream |
|---|---|---|---|
| `lidar-dtm` | palette PNG | `[2,2]` / 0 | `wms.geonorge.no/skwms1/wms.hoyde-dtm-nhm-25833` |
| `lidar-dom` | palette PNG | `[2,2]` / 0 | `wms.geonorge.no/skwms1/wms.hoyde-dom-nhm-25833` |
| `lidar-dtm-held`, `lidar-dom-held` | palette PNG, transparent | — | none (`sources: []`) |
| `topo-ref`, `topo-ref-contours` | palette PNG, transparent | `[4,4]` / 80 | `wms.geonorge.no/skwms1/wms.topo` |
| `amtskart` | RGBA PNG | `[4,4]` / 80 | `wms.geonorge.no/skwms1/wms.historiskekart` (`amt1`) |
| `flyfoto` | JPEG | `[2,2]` / 0 | nib-proxy → `services.norgeibilder.no/wms/ortofoto` |

- **Eligibility**: only a layer whose `LAYERS`/`STYLES` never vary. Everything
  parameterized at request time stays on wmscache — per-project LiDAR flights,
  the RA themes, the LiDAR extract's arbitrary bboxes, the float DEM, the
  per-acquisition ortofoto `mosaicRule`.
- **`-held` siblings**: the same two MBTiles files with no source behind them.
  Never seeded, never written, only reached while the `hoyde` breaker is open
  (see below). A miss answers a transparent tile.
- **Grid** `tufteseid25833`: EPSG:25833, bbox `-2500000, 3500000, 3045984,
  9045984`, `min_res: 21664.0`, `res_factor: 2`, 512 px tiles, `origin: nw`,
  `num_levels: 21`. Mirrors `src/map/layers/wmsTileGrid.ts` level for level
  (z12 = 5.289 m/px, z16 = 0.331), so no reprojection and no resampling. Same
  grid describes the cVAT store.
- **Sources**: `supported_srs: ['EPSG:25833']`, `concurrent_requests: 4`,
  `http.client_timeout: 60`, a `coverage` bbox matching the layer config's
  `coverageExtent`. **No `on_error` anywhere** — a shed or non-image response
  must surface as a 500 so `src/upstream/` trips, rather than being stored as a
  blank tile.
- **No `max_size`**: it never evicts. The store grows until somebody prunes it.
  Watch `du`.
- **`X-Cache-Status` means nothing for these six layers** — they do not pass
  through nginx.
- **Store**: one MBTiles per cache under the bind mount
  `/site/tufteseid/data/mapproxy`. MapProxy takes an init lock beside each file
  at startup, so a directory it cannot write to is a hard startup failure, not a
  degraded mode. Symptom: empty 502 on every `/cache/…` while the container
  looks healthy. `7.0.0-alpine-nginx` runs as `uid=100 gid=101` (*not* the
  `USER_UID=1000` its own Dockerfile defaults to):

  ```
  docker compose run --rm --entrypoint sh mapproxy -c \
    'id; touch /mapproxy/config/cache_data/probe && echo WRITABLE || echo DENIED'
  sudo chown -R 100:101 /site/tufteseid/data/mapproxy
  ```

- **`/tiles`, not `/tms/1.0.0`.** A TMS request hard-codes `origin = sw` and
  silently overrules the `origin: nw` in `mapproxy.yaml`; only `/tiles` consults
  it. Getting it wrong is not a flipped map — the mirrored row falls outside
  coverage, MapProxy culls it, and every tile comes back HTTP 200 as the same
  2198-byte transparent PNG, on all six layers.
- **Port 80 and the `/mapproxy` prefix** are the pinned `-alpine-nginx` image's
  own; the listener moved to 9090 after 7.0.0. When bumping the image, read
  `docker/nginx-default.conf` at that tag. Symptom of getting it wrong is
  identical to MapProxy being down: Caddy cannot dial, empty 502 everywhere.

`mapproxy/seed.yaml` pre-fills levels 0–9 over each source's coverage. Run by
hand, never scheduled. No `refresh_before`: MBTiles stores no per-tile
timestamp, so any refresh time rebuilds every tile in the task.

```
docker compose exec mapproxy mapproxy-seed -c 4 \
  -f /mapproxy/config/mapproxy.yaml -s /mapproxy/config/seed.yaml --seed ALL
```

## wmscache (nginx)

`nginx/wms-cache.conf` holds the cache zone, the two skip maps, and one
`upstream` plus one `location` per host. `nginx/wms-proxy-common.conf` holds the
host-independent half and is `include`d from the locations that want the
defaults.

| Location | `proxy_cache_valid 200` | `proxy_read_timeout` | Notes |
|---|---|---|---|
| `/skwms1/` (Kartverket WMS) | 180d | 30s | shared include |
| `/wfs-skwms1/wfs.hoyde-hoydedata-metadata-prosjekt` | 180d | 8s | LiDAR footprints; spelled out |
| `/wfs-skwms1/` (rest of WFS) | not cached | 8s | spelled out; no cache directives at all |
| `/wms/` (Riksantikvaren) | 180d | 30s | shared include; slowest origin in the stack |
| `/kms-api/` | 7d | 8s | spelled out |
| `/hoydedata-arcgis/` | 180d | 30s | shared include |
| `/nib-arcgis/prosjekter/` | 7d | 15s | spelled out; **no `proxy_next_upstream`** |
| `/nib-arcgis/` | 180d | 30s | shared include |
| `/nib-wms/` | 180d | 30s | shared include |

Longest prefix wins, so the carve-outs take precedence whatever the file order.
They spell their directives out rather than `include` the common file because
nginx rejects a duplicate `proxy_cache_valid`, `proxy_read_timeout` or
`proxy_next_upstream` outright, and a config error stops the whole server.

### Cache zone

`proxy_cache_path /var/cache/nginx/wms levels=1:2 keys_zone=wms:100m
max_size=25g inactive=180d use_temp_path=off` — one 25 GB LRU shared by every
location. The key is the default (the request URI), whose internal prefix keeps
upstreams apart.

### Upstream groups

```nginx
upstream geonorge_upstream {
    server wms.geonorge.no:443 max_fails=0;   # three identical peers …
    server wms.geonorge.no:443 max_fails=0;
    server wms.geonorge.no:443 max_fails=0;
    keepalive 32;                             # 8 on the WFS, KMS and hoydedata groups
    keepalive_timeout 20s;
}
```

- **Three peers because nginx caps the retry budget at the peer count.**
  `proxy_next_upstream_tries` can only lower it, so a one-server group makes
  `proxy_next_upstream` a silent no-op.
- **`max_fails=0` on every peer**, or one burst of 502s marks all three down at
  once (`no live upstreams`, a blank viewport).
- **`keepalive_timeout 20s`, under nginx's 60 s default.** If the far end closes
  first, the next request pulls a dead socket out of the pool and 502s in ~60 ms.
  `wms.geonorge.no` (istio-envoy) holds an idle connection past 75 s, so 20 s
  closes first by a wide margin. Measure before moving it.

Static `upstream` blocks, no `resolver`: a variable-based `proxy_pass` leaks
HTTP 426 to the browser. nib-proxy is the exception — a compose service's IP
changes, so its three locations carry `resolver 127.0.0.11 valid=30s ipv6=off`
and a variable backend. **`set $nib_backend` must precede the `rewrite … break`**:
`break` halts the rewrite module, leaving the variable empty and producing
"no host in upstream".

The three tries do not catch everything. About one cold GetMap in 200 against
the per-project LiDAR namespace comes back 502 from Kartverket's own front
(`server: nginx/1.20.1`, not ours) under a burst and survives all three — they
go out back to back with no directive to space them, so all three land in the
same shed window. The working lever is a *delayed* retry, which lives in
`src/upstream/tileGuard.ts`.

### The two skip guards

The gotcha: **Kartverket rate-limits with an HTTP 200.** Over budget,
`wms.geonorge.no` answers 200 / `application/vnd.ogc.se_xml`, 238 bytes
("Overforbruk på kort tid"). nginx's `proxy_next_upstream` reads status codes
only, so it cannot fail that over; without a guard it is cached as a tile.

```nginx
# Guard 1: size. Under 300 bytes is an error body. Real no-data tiles
# (479 bytes) must stay cacheable.
map $upstream_http_content_length $skip_cache {
    default           0;
    "~^[0-9]{1,2}$"   1;
    "~^[12][0-9]{2}$" 1;
}

# Guard 2: type. Content-Type survives chunking; Content-Length does not.
map $upstream_http_content_type $skip_cache_type {
    default    0;
    "~*se_xml" 1;
}

map $skip_cache$skip_cache_type $tile_cache_control {
    "00"    "public, max-age=604800, immutable";
    default "no-store";
}
```

Both feed `proxy_no_cache $skip_cache $skip_cache_type;`.

- **Guard 1 is blind on the two busiest hosts.** `wms.geonorge.no` and
  `kart.ra.no` both answer chunked, with or without the `Accept-Encoding ""`
  below, so they never declare a length and the map is permanently 0 there. Only
  the per-project namespace, which sends a bare `content-length: 0`, is caught.
- **Guard 2 is the one that catches the shed response.** Keep it narrow:
  `text/xml` would take RA's `vnd.ogc.gml` GetFeatureInfo answers out of the
  cache too.
- **Do not raise the length floor** to exclude no-coverage tiles: they are
  deterministic per bbox, cost 0.3–6 s each at the origin, and are most of a
  zoomed-out screen.
- **Do not add `proxy_cache_bypass $skip_cache`.** It is evaluated at request
  time, when `$upstream_http_content_length` is still empty, so nothing would
  ever be served from cache.

### The rest of `wms-proxy-common.conf`

```nginx
proxy_set_header Accept-Encoding "";   # gzipping a PNG buys nothing;
                                       # does NOT restore Content-Length
proxy_cache_valid 200 180d;
proxy_cache_valid 404 10m;             # negative caching: without it only 200s
proxy_cache_valid 400 403 1m;          # are stored and tileGuard retries ×3
proxy_cache_lock on;
proxy_cache_lock_timeout 30s;
proxy_cache_lock_age 30s;              # the 5s default breaks the lock mid-render
                                       # on a 5-14 s cold tile — that is the split
                                       # view's two Maps exactly
proxy_cache_use_stale updating error timeout http_500 http_502 http_503 http_504;

proxy_ignore_headers Set-Cookie Cache-Control Expires Vary X-Accel-Expires;
proxy_hide_header Set-Cookie;          # wms.geonorge.no sends JSESSIONID
proxy_hide_header Cache-Control;       # hide, not just ignore: with two on the
proxy_hide_header Expires;             # wire the browser takes the stricter
proxy_hide_header Pragma;
add_header Cache-Control $tile_cache_control;   # no `always`, so a 502/504 and
                                                # the negative-cached 400/403/404
                                                # carry no freshness
proxy_connect_timeout 10s;
proxy_read_timeout 30s;
proxy_send_timeout 10s;
proxy_next_upstream error http_502 http_503 http_504;   # no `timeout`
proxy_next_upstream_tries 3;
proxy_next_upstream_timeout 45s;
add_header X-Cache-Status $upstream_cache_status always;
```

- **`Vary` is ignored on purpose**: nginx stores a secondary hash per variant,
  and `hoydedata.no` sends `Vary: Origin` on the 4 MB float-DEM path — one
  CORS-mode `fetch` from doubling those entries.
- **`timeout` is out of the retry list here** and in the WFS/KMS lists: these
  upstreams render on the fly, so a read timeout is a render still running and
  retrying queues a second one for the same tile. The WFS and `/kms-api/`
  locations *do* include `timeout`, because those do no rendering — they answer
  in ~0.25 s or hang forever.
- **`immutable` on top of a week is safe**: these come out of a 180-day LRU, so
  a browser copy inside its `max-age` can never be staler than what this proxy
  would answer. No upstream sends a usable `Cache-Control` or a validator.
- **`log_format wmscache`** omits `$remote_addr` on purpose — `$request_uri`
  holds a coordinate. `scripts/usage-report.sh` reads the first five fields
  positionally.

### Restart requirement

`docker compose up -d` is not enough. The configs are bind-mounted but nginx
reads them only at startup and the container is not recreated:
`docker compose restart wmscache`. Same for `mapproxy/` and
`docker compose restart mapproxy`.

## nib-proxy

`nib-proxy/server.mjs`, `node:24-alpine`, zero dependencies, listens on `:8080`.

- **Anonymous mint**: `GET https://backend-api.klienter-prod-k8s2.norgeibilder.no/token/nib`
  with `Referer: https://norgeibilder.no/`. No login.
- **The token is bound to the requesting IP and referer**, so it must be minted
  and used in the same place. A token never travels between workstation and
  server — mint a fresh one wherever the call is made.
- **Lifetime**: the JWT's own `exp` when present, otherwise a 20-minute
  fallback; refreshed 60 s before expiry. Concurrent mints are coalesced.
- **Re-mint and retry once** on auth failure: HTTP 401/403/498/499, *or* a JSON
  body carrying `error.code` at any status — ArcGIS answers auth failures with
  HTTP 200 as often as with a 4xx. After two attempts the sidecar answers 502,
  so nginx does not cache the failure as a tile.
- **Injected as `X-Esri-Authorization: Bearer …`**, never `&token=`, so cache
  keys stay stable as it rotates and it never reaches the browser.
- **Namespace routing**: a path starting `/arcgis/` goes to
  `services.norgeibilder.no/arcgis/rest/services`; everything else to
  `services.norgeibilder.no/wms`. After the upstream rewrites a WMS request is a
  bare service name (`/ortofoto`), so that marker is the only disambiguator.
- **Content-Type repair**: `ortofoto_prosjekter/ImageServer` answers
  `format=jpgpng` as `application/octet-stream` (JPEG inside coverage, a
  ~1097-byte transparent PNG outside). An `<img>` refuses that under Caddy's
  global `X-Content-Type-Options: nosniff`, so the handler sniffs magic bytes
  and re-labels ahead of wmscache. One format is not an option: `jpg` paints the
  gaps opaque black, `png32` costs ~8× the bytes.
- Requests upstream carry `Accept-Encoding: identity`, so Content-Length is
  accurate for nginx's cache.
- `/healthz` answers `200 ok`.

## cvat-tiles

`/cvat/<acquisition>/<z>/<x>/<y>.webp` → `cvat-tiles:8080`, one indexed `SELECT`
against `<acquisition>.mbtiles` in `/site/tufteseid/data/cvat`. Never leaves the
stack: no wmscache entry, no CSP host.

- **A 404 on a missing tile is load-bearing** — it is the coverage mask
  (`docs/map-layers.md`). The sidecar answers a missing row with a 404, not a
  blank tile.
- **`/cvat/manifest.json` is synthesized**, not a file: the sidecar surveys the
  directory at most once per 10 s (`SCAN_MS`), reads each database's `metadata`
  for the acquisition name and level range, and releases a cached handle whose
  file was replaced underneath it. A database copied into the store needs
  nothing edited, imported or restarted; an empty store answers an empty list.
- One database per acquisition; the path segment names it. Overlapping flights
  are separate rows and may not share a `<z>/<x>/<y>`.
- `tile_row` is the MBTiles spec's, counted from the south, but the grid under
  it is the app's EPSG:25833 one — a generic MBTiles reader would place these
  tiles in the Atlantic.

## Kulturminnesøk (`/kms/*`)

The one upstream here that is not a map source: one JSON lookup per heritage
card, resolving an Askeladden id to a Kulturminnesøk uuid. Proxied because the
API sends no CORS headers at all.

A large minority of the register is not in that index. A miss is a 200 echoing
the raw number back, and the record API then answers 200 with an all-null shell;
`src/map/featureInfo/kulturminnesok.ts` reads a null `externalid` as the miss
and marks the link rather than hiding it. Cached 7 d (`/kms-api/`), because a
missing record is one RA reindex from existing.

## CSP

Everything above is same-origin, so none of those hosts appears in the
Caddyfile CSP. It covers only what the browser contacts itself:

- `img-src 'self' data: blob: cache.kartverket.no` — the WMTS tiles are the only
  images not fetched same-origin.
- `connect-src 'self' data: blob: *.geonorge.no *.norgeskart.no
  cache.kartverket.no hoydedata.no` — `cache.kartverket.no` for its
  GetCapabilities `fetch()`, `*.geonorge.no` for the `ws.geonorge.no` point
  registers, `*.norgeskart.no` for the matrikkel search API (`api.norgeskart.no`
  in `src/env.ts`), `hoydedata.no` for the ArcGIS identify in
  `src/search/searchApi.ts`.

**Routing a new upstream through wmscache is never a CSP change; calling one
directly from the browser always is.**

## Tile-loading limits (client)

The budget: `wms.geonorge.no` meters GetMap by source IP — the *server's*, so
every visitor shares one budget — at roughly 120 GetMaps over a short window.
Over it comes the 200 / `se_xml` shed response, which the browser cannot decode,
so OpenLayers marks the tile `ERROR` and never retries it. The only defence is
fewer requests.

| Setting | Value | Where |
|---|---|---|
| `maxTilesLoading` | 48 (OL default 16) | `src/map/atoms.ts`, `src/map/compare/splitMap.ts` |
| Tile size | 512 px, every layer | `wmsTileGrid.ts` (`WMS_TILE_SIZE`) |
| `WMS_TILE_CACHE_SIZE` | 128 (~10 screenfuls) | `wmsTileGrid.ts` |
| `WMS_Z_DIRECTION` | 1 (the coarser bracketing level) | `wmsTileGrid.ts` |
| `VIEW_MAX_ZOOM` | 20 | `wmsTileGrid.ts` |
| `preload` | 2 on the WMTS base and the cVAT ground, 0 everywhere else | `backgroundLayers/` |
| `hidpi` | `false` on `TileArcGISRest` | `backgroundLayers/utils.ts` |
| `FEATURE_COUNT` | 10 | `featureInfoService.ts` |
| `FEATURE_INFO_DEADLINE_MS` | 12 000 | `featureInfoService.ts` |
| GetFeatureInfo memo | 400 entries, URL-keyed | `featureInfoService.ts` |
| Pointer snap grid | 6 px | `heritageQuery.ts` |

- **Split view is a second `Map` with its own queue**, also 48, so up to 96
  tiles in flight. The queue is a per-map scheduler, not a budget against the
  upstream; the two half-width panes still cover about one screenful.
- **Curtain**: the `prerender` canvas clip culls nothing — the renderer has
  already queued the whole viewport — so the B stack also carries a layer
  `extent`, intersected with its `coverageExtent` and recomputed on `moveend`
  and as the handle is dragged. Without it the curtain costs a full second
  screenful to show half of one. Neither compare mode is persisted to the URL.
- **`preload: 0` on the `/cache/` layers despite their being tiles**: a MapProxy
  miss is a GetMap, and a preloaded tile would hold a slot for the length of it.
  `XYZBackgroundLayer` carries `preload` per store for that split.
- **512 px, not 256**: at 256 a 1600×1000 viewport is ~35 tiles per layer per
  level, and LiDAR project mode stacks two WMS layers — 70 requests a zoom step.
  Bytes are a wash. `TileWMS` pins its pixel ratio to 1 unless `serverType` is
  set, and none of these sources sets one, so it stays 512 on HiDPI.
- **`getWMSTileGrid(projection, minZoom, maxZoom)`** hands over the whole
  resolution array indexed by absolute z, fenced by `minZoom` and the array's
  end, so a store holding only some levels still aligns (a cVAT acquisition
  passes z7–z15, the national relief z0–z16).
- **`interpolate: false` on the relief** — the `/cache/` national mosaics, the
  same mosaics' WMS, the per-project LiDAR WMS, and the cVAT ground. These are
  read upsampled, and OL's bilinear kernel clamps at each tile's edge, leaving a
  visible step at every seam. Photographs, scanned sheets and the label overlay
  keep the default.
- **Ortofoto asks for JPEG** (68 kB against 528 kB per 512 px tile over Oslo);
  a single acquisition needs transparent gaps and uses `jpgpng`.
- **Every background layer that can reach an upstream needs a `coverageExtent`**
  (`{ extent, crs }`, transformed into the layer's `extent` with 8 stops per
  edge). Without one OL spans the whole EPSG:25833 projection extent and orders
  renders over the Atlantic. The same numbers appear as each source's `coverage`
  in `mapproxy.yaml`.

  | Source | EPSG:25833 extent |
  |---|---|
  | LiDAR national mosaic + DOM (`LIDAR_COVERAGE_EXTENT_25833`) | `-100275, 6399725, 1150255, 8000275` |
  | `wms.topo` overlay, and `amtskart` | `-127998, 6377920, 1145510, 7976800` |
  | NiB ortofoto mosaic | `-250025, 6299985, 1211155, 8985010` |
  | one LiDAR project, one ortofoto acquisition | its own `bboxLonLat` (EPSG:4326) |

  Per-project cases must use their own box; the services advertise the union of
  everything they hold. The cVAT ground needs one for a different reason: not to
  spare an upstream, but to keep the layer off ground the flight never covered.

### Off-screen grabs

Four producers fetch outside OpenLayers' tile queue, so none of the settings
above applies to them. Each plans its own tiles with `planTiles`
(`src/lidarExtract/stitch.ts`, canvas capped at `MAX_CANVAS_PX_PER_SIDE` =
12 000 px a side) and runs them through `runWithConcurrency` with its own
ceiling and its own bounded retry.

| Producer | Upstream | Concurrent | Retries |
|---|---|---|---|
| LiDAR extract / evidence (`lidarExtract/run.ts`) | `/wms/…` per-project or national relief | 4 | 3 |
| Float DEM (`terrain/dem.ts`) | `/wms/hoydedata/…` | 3 | 3 |
| Flyfoto evidence, mosaic (`evidence/flyfotoRaster.ts`) | `/wms/nib/ortofoto` GetMap, EPSG:25833, JPEG | 4 | 3 |
| Flyfoto evidence, one acquisition (same file) | `/arcgis/nib/…/exportImage` with a `mosaicRule` | 4 | 3 |

- **A kept render goes past mapproxy on purpose.** The flyfoto *ground* reads
  `/cache/flyfoto`, meta-tiled onto the app's own grid at whatever level is up; a
  kept render asks the WMS for an arbitrary bbox at the acquisition's own
  resolution, because that resolution is the point of keeping. So it is a
  wmscache path, and it is a cache miss nearly every time — no two footprints
  share a bbox.
- **The render queue is serial** (`src/evidence/queue.ts`): one job at a time,
  whatever the reader clicks. Two 4-wide fan-outs at once finish no sooner and
  invite the shed response.
- **A 500 m footprint is the cap** (`MAX_SIDE_M`, `src/map/bbox.ts`), which at
  0.2 m/px is 2500 px a side — a handful of tiles, not a screenful.

### `guardTileSource` (`src/upstream/tileGuard.ts`)

Wraps a tile source in admission control (for origins the breaker knows) plus a
bounded retry (for every source that reaches an upstream, including those no
origin claims).

- Two retries at 400 ms and 900 ms, plus up to 300 ms jitter, then the tile is
  left `ERROR`. Without it the ~1-in-200 upstream 502 is a hole that lasts until
  reload, and only at the zoom level it happened on.
- Every failed try reports to the breaker, so an outage trips it in fewer tiles,
  not more.
- A tile the breaker *refused* is not retried and not counted; it comes back via
  `refresh()` on recovery.
- `heldUrl` redirects a refused tile to a source-less store instead — the two
  national mosaics only.
- `sparse: true` opts out of the retry: the cVAT ground only. A 404 inside its
  extent is the coverage mask, and an `<img>` error carries no status, so the
  retry cannot tell a mask hole from a dropped request. `/cache/` needs no such
  flag — MapProxy culls to a coverage polygon and answers a blank 200 inside it.

## Circuit breaker (`src/upstream/`)

One breaker per origin, plus the ribbon chip that reports an open one. An origin
is the set of requests that stop answering together, not a hostname.

| Origin | Prefixes | Probe |
|---|---|---|
| `hoyde` | `/wms/geonorge/wms.hoyde-`, `/wfs/geonorge/wfs.hoyde-`, `/arcgis/hoydedata/`, `/cache/lidar-dtm/`, `/cache/lidar-dom/` | 1×1 GetMap on `wms.hoyde-dtm-nhm-25833` |
| `kartverketCache` | `cache.kartverket.no` (direct from the browser) | coarsest WMTS tile |
| `ra` | `/wms/ra/` | 1×1 GetMap on `kulturminner2` |
| `nib` | `/wms/nib/`, `/arcgis/nib/`, `/cache/flyfoto` | 1×1 GetMap on `ortofoto`, JPEG |

`/cache/topo-ref*`, `/cache/amtskart` and `/kms/` are in no origin by design: a
different renderer and one layer each. They keep the retry, which is their only
recourse — no probe, no `refresh()`.

The two `/cache/lidar-*` prefixes are spelled out in full rather than
`/cache/lidar-`, which would also match the `-held` siblings and refuse the way
out.

Constants (`health.ts`):

| | |
|---|---|
| `FAIL_THRESHOLD` | 3 failures **net of successes** |
| `FAIL_WINDOW_MS` | 60 000 |
| `PROBE_TIMEOUT_MS` | 8 000 (under the proxy's 30 s read timeout) |
| `PROBE_BACKOFF_MS` | 20 000 → 40 000 → 80 000 → 120 000 |
| `HEALTHY_RESET_MS` | 60 000 of continuous health before the backoff forgets |

- **Net, not consecutive**: `proxy_cache_use_stale` serves cached tiles straight
  through an upstream 504, so a pan over half-visited ground interleaves hits
  and failures. A success pays the counter down by one rather than zeroing it.
- **While open, no request goes out.** Tiles are marked `ERROR` without touching
  the network (a tile left `LOADING` holds a slot); `fetchWithin` throws
  `UpstreamDownError` before fetching, which the retry loops in `dem.ts`,
  `flyfoto.ts`, `lidarExtract/run.ts`, `evidence/flyfotoRaster.ts` and the
  footprint fan-out short-circuit on.
- **`status >= 500` is a failure; everything else, 4xx included, is alive.** The
  mechanism fails open, so a probe URL that goes stale reads as *up* rather than
  wedging an origin shut.
- **On recovery, guarded sources are `refresh()`ed** — OpenLayers caches the
  `ERROR` state and will not re-request without it.
- **Two cache interactions are load-bearing.** The WMS probe answers are under
  the 300-byte `$skip_cache` floor, so they never enter the LRU; and
  `probeUrl()` appends `&_probe=<now>` to the proxied ones, because a probe
  served stale through `proxy_cache_use_stale … http_504` is the one failure the
  breaker cannot recover from. The WMTS probe goes direct to a CDN that sends
  `max-age`, so it relies on `cache: 'no-store'` instead.

## Recipe: add an external map source

**Same `LAYERS`/`STYLES` on every request** → MapProxy:

1. `mapproxy/mapproxy.yaml`: a `sources` entry (url, layers,
   `supported_srs: ['EPSG:25833']`, `concurrent_requests`,
   `http.client_timeout`, a `coverage` from its GetCapabilities, no `on_error`);
   a `caches` entry on `tufteseid25833` with a `meta_size` and an mbtiles
   filename; a `layers` entry whose `name` is the `/cache/<name>/` segment.
2. Nothing in `Caddyfile` — the one `@tileCache` regexp already routes it.
3. An `XYZBackgroundLayer` config on `/cache/<name>/{z}/{x}/{y}.<fmt>`, with
   `preload: 0` and a `coverageExtent`.
4. A `seeds` task if the coarse levels are worth pre-filling.
5. `docker compose restart mapproxy`.

**Parameterized at request time** → wmscache:

1. `Caddyfile`: a `handle_path /wms/<host-slug>/*` block rewriting to a unique
   internal prefix, `reverse_proxy http://wmscache`.
2. `nginx/wms-cache.conf`: an `upstream` block — the host three times,
   `max_fails=0`, `keepalive`, `keepalive_timeout 20s`.
3. A `location` for that prefix which rewrites into the upstream's own path,
   sets `proxy_pass`, `Host` and `proxy_ssl_name`, and `include`s
   `/etc/nginx/wms-proxy-common.conf`. Spell directives out instead only if this
   upstream needs a different lifetime or timeout.
4. `/wms/<host-slug>/…` as `wmsUrl` in the layer config. No CSP entry.
5. For a background layer, `coverageExtent` from its GetCapabilities.
6. The layer-config half — name union, config file, `infoFormat` — is
   `docs/map-layers.md`.
7. Nothing for the breaker unless the source is a *fifth* thing that can fail on
   its own. A layer under one of the four prefixes is covered; one under none
   has no breaker, which is the right answer for a single overlay.
8. `docker compose restart wmscache`.

## Verifying

On the server; the workstation has no docker daemon and cannot reach these
paths.

```
docker compose exec wmscache nginx -T | grep 'read_timeout\|max_fails\|next_upstream'
curl -sI "http://localhost:3030/wms/geonorge/wms.hoyde-dtm-nhm-25833?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=NHM_DTM_25833:skyggerelieff&CRS=EPSG:25833&BBOX=200000,6500000,300000,6600000&WIDTH=512&HEIGHT=512&FORMAT=image/png" | grep -i 'x-cache\|cache-control'
docker run --rm -v tufteseid_wmscache:/c alpine du -sh /c

docker compose exec mapproxy mapproxy-util grids -f /mapproxy/config/mapproxy.yaml -g tufteseid25833
curl -s "http://localhost:3030/cache/lidar-dtm/13/<x>/<y>.png" -o a.png
sudo du -sh /site/tufteseid/data/mapproxy
```

`nginx -T` prints what nginx loaded, not what the file says. The `curl -sI` is
MISS then HIT, both `max-age=604800`. The grid dump printing 0.331 m/px at z16
and 5.289 at z12 is the alignment check against `wmsTileGrid.ts`. Then the map
itself, network panel open: a cold pan should cost one upstream GetMap per 2×2
or 4×4 block, not one per tile.
