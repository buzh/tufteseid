# WMS proxying, caching and tile loading

How map requests leave the browser, how they are cached, and how few of them we
may spend. Read before touching `Caddyfile`, `nginx/`, `nib-proxy/`,
`src/map/layers/wmsTileGrid.ts`, or before adding an external map source. What
is drawn with them is `docs/map-layers.md`.

## Topology

Browser → Caddy (`tufteseid` container, `:3000`; host `3030`) → wmscache
(`nginx:1.27-alpine`, 25 GB disk cache, not exposed on the host) → upstream.
Caddy puts each upstream under a same-origin prefix and rewrites it into an
internal namespace; wmscache rewrites that into the upstream's own path and
caches the answer. `nib-proxy` (`node:24-alpine`, zero deps) is a
token-injecting sidecar for Norge i bilder, reachable only from wmscache on the
compose network — the only internal upstream, and the only one resolved at
request time (Docker DNS `127.0.0.11`), since a compose service's IP changes.

`mapproxy` is a second chain beside it, not a stage in it: Browser → Caddy →
mapproxy → upstream, with wmscache nowhere in the path. It holds the handful of
layers nobody ever asks a question of — same LAYERS, same STYLES, every request
— as tiles on the app's own grid, and reaches the upstream itself. `/cache/*` is
its prefix; the section below is the whole of it.

`cvat-tiles` is beside both rather than in either: Caddy proxies `/cvat/*`
straight to it, and what it serves is ours, computed here and read off disk, so
there is nothing upstream to cache.

## Prefixes

| Same-origin prefix | Internal (nginx) | Upstream |
|---|---|---|
| `/wms/geonorge/wms.foo` | `/skwms1/` | `wms.geonorge.no/skwms1/wms.foo` |
| `/wfs/geonorge/wfs.foo` | `/wfs-skwms1/` | `wfs.geonorge.no/skwms1/wfs.foo` |
| `/wms/ra/kulturminner2` | `/wms/` | `kart.ra.no/wms/kulturminner2` |
| `/kms/api/v2/search/123` | `/kms-api/` | `kms-api.kulturminnesok.no/api/v2/search/123` |
| `/wms/nib/ortofoto` | `/nib-wms/` | nib-proxy → `services.norgeibilder.no/wms/ortofoto` |
| `/arcgis/nib/*` | `/nib-arcgis/` | nib-proxy → `services.norgeibilder.no/arcgis/rest/services/*` |
| `/arcgis/hoydedata/*` | `/hoydedata-arcgis/` | `hoydedata.no/arcgis/rest/services/*` |

The internal aliases differ so the namespaces cannot collide inside nginx: WFS
would want the WMS host's `/skwms1/`, and both ArcGIS upstreams `/arcgis/`.
`/pb/*` → `pocketbase:8090` is not a map route, nor is `/l/<code>`, a `redir`
to `/?lok=<code>`; `file_server` has no SPA fallback, so any other unknown path
still 404s.

`/cache/<layer>/<z>/<x>/<y>.<png|jpeg>` is the other half, and does not go
through wmscache at all:

| Same-origin prefix | Internal | Upstream |
|---|---|---|
| `/cache/lidar-dtm/…` | `mapproxy:9090/mapproxy/tms/1.0.0/lidar-dtm/tufteseid25833/…` | `wms.geonorge.no/skwms1/wms.hoyde-dtm-nhm-topobathy-25833` |
| `/cache/lidar-dom/…` | same, `lidar-dom` | `wms.geonorge.no/skwms1/wms.hoyde-dom-nhm-25833` |
| `/cache/topo-ref/…`, `/cache/topo-ref-contours/…` | same | `wms.geonorge.no/skwms1/wms.topo` |
| `/cache/amtskart/…` | same | `wms.geonorge.no/skwms1/wms.historiskekart` |
| `/cache/flyfoto/…` | same | nib-proxy → `services.norgeibilder.no/wms/ortofoto` |

One Caddy block covers all six: a `path_regexp` takes the layer name out of the
path and substitutes it into MapProxy's TMS path, so the grid name and the
service version are written once. `:9090` and the `/mapproxy` prefix are the
`-alpine-nginx` image's own (nginx in front of uwsgi, `SCRIPT_NAME=/mapproxy`).
A `/cache/` name MapProxy does not publish 404s from MapProxy, which is the
same answer as refusing it at the edge and one less list to keep in step.

`/cvat/<acquisition>/<z>/<x>/<y>.webp` is not in the table because it never
leaves the stack: `handle_path /cvat/*` hands it to the `cvat-tiles` sidecar
(`node:24-alpine`, zero deps, `node:sqlite`), which turns it into one indexed
`SELECT` against `<acquisition>.mbtiles` in the bind-mounted store. No wmscache
entry and no CSP host. The path segment is the acquisition's own database,
which the manifest hands the app as its tile template — overlapping flights are
offered as separate rows and may not share a `<z>/<x>/<y>`. The 404 on a tile
that was never written is load-bearing — it is the coverage mask
(`docs/map-layers.md`) — so the sidecar answers a missing row with one rather
than with a blank tile. `/cvat/manifest.json` is read off the same directory
and fetched once per page load; `connect-src 'self'` already covers it, and its
own 404 on an install without a store reads as an empty store.

One database per acquisition rather than a tree of files: an acquisition is
~83 000 WebP tiles, the store holds nine of them, and the inodes dwarfed the
bytes. MBTiles is the container only — `tile_row` is the spec's, counted from
the south, but the grid under it is the app's EPSG:25833 one, so a generic
MBTiles reader would place these tiles in the Atlantic. A store of loose files
is packed with `vat-cache/pack_store.py`.

## Cache rules (wmscache)

`nginx/wms-cache.conf` holds the cache zone, the `$skip_cache` map and one
`upstream` plus one `location` per host; `nginx/wms-proxy-common.conf` holds
the host-independent half and is `include`d from each location.

| Location | `proxy_cache_valid 200` | `proxy_read_timeout` | Notes |
|---|---|---|---|
| `/skwms1/` (Kartverket WMS) | 180d | 30s (shared) | shared include |
| `/wfs-skwms1/wfs.hoyde-hoydedata-metadata-prosjekt` | 180d | 8s | LiDAR footprints |
| `/wfs-skwms1/` (rest of WFS) | not cached | 8s | register data should be fresh |
| `/wms/` (Riksantikvaren) | 180d | 30s (shared) | slowest origin in the stack |
| `/kms-api/` | 7d | 8s | a missing record is one RA reindex from existing |
| `/hoydedata-arcgis/` | 180d | 30s (shared) | DEM for a fixed bbox never changes |
| `/nib-arcgis/prosjekter/` | 7d | 15s | the acquisition catalogue *grows* |
| `/nib-arcgis/` | 180d | 30s (shared) | a completed acquisition's pixels do not |
| `/nib-wms/` | 180d | 30s (shared) | shared include |

Longest prefix wins, so the carve-outs take precedence whatever the file order.
They spell their directives out rather than `include` the common file because
nginx rejects a duplicate `proxy_cache_valid`, `proxy_read_timeout` or
`proxy_next_upstream` outright, and a config error stops the whole server.

- 25 GB LRU on `/var/cache/nginx/wms`, `inactive=180d`, `keys_zone=wms:100m`,
  shared; the key is the request URI, whose prefix keeps upstreams apart.
- Static `upstream` blocks, no `resolver` — a variable-based `proxy_pass` leaks
  HTTP 426 to the browser. NiB is the exception, for Docker DNS.
- Each host is listed three times: nginx takes the retry budget from the peer
  count and `proxy_next_upstream_tries` can only lower it, so a one-server
  group never retries, silently. `max_fails=0` on every peer, or a burst of
  502s marks all three down (`no live upstreams`, a blank viewport).
  `keepalive_timeout 20s`, under nginx's 60s default: a socket the far end
  closed first 502s in ~60 ms, and every peer draws on one pool.
- `timeout` goes in the WFS and `/kms-api/` `proxy_next_upstream` lists only.
  Those answer in ~0.25 s or hang forever; a WMS can take 5–14 s cold, where a
  read timeout means a live render and a retry queues a second for one tile.
- `$skip_cache` (a map on `$upstream_http_content_length`) refuses to store
  under 300 bytes, keeping the ~100-byte JSON error and the 238-byte rate-limit
  notice out of a 180-day entry. Do not raise the floor to exclude no-coverage
  tiles: deterministic per bbox, 0.3–6 s each at the origin, and most of a
  zoomed-out screen.
- `Accept-Encoding ""` — Kartverket's per-project WMS otherwise answers gzipped
  and chunked with no `Content-Length`, and `$skip_cache` cannot decide.
- `proxy_ignore_headers Set-Cookie Cache-Control Expires`, or session cookies
  disable caching; `proxy_cache_lock on`, one request per cold key; not
  `proxy_cache_bypass $skip_cache`, evaluated before the length exists.
- `Cache-Control` to the browser is rewritten to `$tile_cache_control`
  (`public, max-age=604800`; `no-store` on `$skip_cache`), since no upstream
  sends a usable one or a validator. Hide the upstream's own header rather than
  ignoring it — with two on the wire the browser takes the stricter — and leave
  `always` off the `add_header`, so a 502/504 carries no freshness; the rate
  limit arrives as a 200 and is caught on length instead.
- `X-Cache-Status: HIT|MISS|BYPASS` is added for debugging.

## The tile cache (mapproxy)

`mapproxy/mapproxy.yaml` is the whole configuration; `mapproxy/seed.yaml` is the
pre-fill, run by hand and never on a schedule.

**What it takes.** Only a layer whose request never varies. Six caches over six
sources: the DTM and DOM national mosaics' `skyggerelieff`, the hybrid overlay
with and without contours, amtskart's `amt1`, and the NiB ortofoto mosaic. Every
other WMS in the stack is parameterized at request time and stays on wmscache —
the 1936 per-project LiDAR flights (`LAYERS=<project id>:<style>`), the
Riksantikvaren themes whose `LAYERS`/`STYLES` come from the reader's register
settings, the LiDAR extract's arbitrary-bbox GetMaps, the float DEM, the
per-acquisition ortofoto picked by a `mosaicRule`. A cache block per combination
is not a cache.

**Why, twice over.** Meta-tiling is the point: `meta_size: [2,2]` or `[4,4]`
turns 4 or 16 tile requests into one upstream GetMap, which is the lever left
after 512 px tiles against `wms.geonorge.no`'s ~120-per-window budget. And
MapProxy's WMS client validates the content type, so it sees the 238-byte
`application/vnd.ogc.se_xml` shed response for what it is — the failure nginx
structurally cannot catch, since `proxy_next_upstream` reads status codes only.

**The grid is the app's, exactly.** `tufteseid25833` is EPSG:25833 over
`-2500000, 3500000, 3045984, 9045984` with `min_res: 21664.0`, `res_factor: 2`,
512 px tiles and a NW origin — `src/map/layers/wmsTileGrid.ts` level for level,
because the projection extent is square and both derive the same ladder from it
(z12 = 5.289 m/px, z16 = 0.331). So no reprojection and no resampling, and the
same grid definition describes the cVAT store. It also means there is only the
one grid: a `?projection=` that puts the view somewhere other than UTM33 leaves
OpenLayers reprojecting these tiles client-side, as it already does for cVAT.

**Sizing, measured rather than guessed.** `[4,4]` with `meta_buffer: 80` on the
two overlays and amtskart — a 2208 px render, inside the `MaxWidth/MaxHeight
8192` both advertise, and the buffer is there so a label or a sheet edge is
never clipped at a seam. `[2,2]` with no buffer on the two reliefs and on
flyfoto: the risk is the tail, not the mean, and the per-project service behind
the same height backend takes 3–12 s cold. The measurements are in the config's
comments; raise them there with evidence.

**No `on_error`, deliberately.** A shed or non-image response surfaces as a 500,
which trips the breaker below and puts the reason on the ribbon, rather than
becoming a silent transparent tile that looks like missing coverage.

**Formats.** The two reliefs and the two overlays are written as 256-colour
palette PNG (`fastoctree`), which is most of the bytes for none of the visible
difference on grey relief and on thin transparent linework. Amtskart is not:
the numbers looked good (586 kB → 63 kB, RMSE 4.15) but the scanned paper tone
mottles visibly, so it keeps RGBA. Flyfoto is JPEG, as it already was.

**Two things it does not do.** It never evicts — there is no `max_size` — so the
store grows until somebody prunes it, bounded only by each source's coverage and
by where people look; watch `du`. And `X-Cache-Status` stops meaning anything
for these six layers, because they no longer pass through nginx.

**The store** is one MBTiles database per cache, under a host bind mount
(`/site/tufteseid/data/mapproxy`) rather than a named volume: the image runs as
uid 1000 where a fresh volume's mountpoint is root-owned, and a cache nobody
evicts should be somewhere an operator can see. First run wants
`sudo mkdir -p` and `sudo chown 1000:1000` on that path.

## The NiB token

- Anonymous: NiB's WMS wants a token even for imagery norgeibilder.no serves to
  anonymous visitors, and the sidecar mints one from the site's public OAuth
  client with a `Referer` header and no login. Re-minted on auth failure,
  including the HTTP-200-with-JSON-error case.
- Bound to the requesting IP and referer, so it must be minted and used in the
  same place. A token never travels between workstation and server — mint a
  fresh one wherever the call is made.
- Injected as a header (`X-Esri-Authorization: Bearer`), never in the URL, so
  cache keys stay stable as it rotates and it never reaches the browser. NiB
  also accepts `&token=`.
- Inside the sidecar, `/arcgis/` routes to the REST upstream and everything
  else to the WMS base; after the rewrites a WMS request is a bare service name
  like `/ortofoto`, so that marker is the only disambiguator.
- The sidecar also fixes NiB's Content-Type.
  `ortofoto_prosjekter/ImageServer` answers `format=jpgpng` — JPEG over
  coverage, a ~1097-byte transparent PNG outside it — labelled
  `application/octet-stream`, which an `<img>` refuses under Caddy's global
  `X-Content-Type-Options: nosniff`, so the handler sniffs magic bytes and
  re-labels ahead of wmscache. One format is not an option: `jpg` paints the
  gaps opaque black, `png32` costs eight times the bytes (68 kB vs 555 kB on a
  512 px tile over Oslo).

## Kulturminnesøk link checking

`/kms/*` is the one upstream here that is not a map source: one JSON lookup per
heritage card. Records in `kulturminner2` and `freda_bygninger` carry a
`linkkulturminnesok` to `kulturminnesok.no/ra/lokalitet/<id>`, resolving an
Askeladden id to a Kulturminnesøk uuid, and a large minority of the register is
not in that index. A miss is a 200 echoing the raw number back, and the record
API then answers 200 with an all-null shell;
`src/map/featureInfo/kulturminnesok.ts` reads a null `externalid` as the miss
and marks the link rather than hiding it. Proxied because the API sends no CORS
headers at all.

## CSP

Everything above is same-origin, so none of those hosts appears in the
Caddyfile CSP. It covers only what the browser contacts itself:

- `img-src 'self' data: blob: cache.kartverket.no` — the WMTS tiles are the
  only images not fetched same-origin.
- `connect-src 'self' data: blob: *.geonorge.no *.norgeskart.no
  cache.kartverket.no hoydedata.no` — `cache.kartverket.no` for its
  GetCapabilities `fetch()`, `*.geonorge.no` for the `ws.geonorge.no` point
  registers, `*.norgeskart.no` for the matrikkel search API, `hoydedata.no` for
  the ArcGIS identify in `src/search/searchApi.ts`.

Routing a new upstream through wmscache is never a CSP change; calling one
directly from the browser always is.

## Tile-loading constraints

Kartverket rate-limits with an HTTP 200. `wms.geonorge.no` meters GetMap by
source IP — the server's, so every visitor shares one budget — over a short
window, roughly 120 GetMaps, not a concurrency limit. Over it the reply is a
200, `application/vnd.ogc.se_xml`, 238 bytes ("Overforbruk på kort tid"), which
the browser cannot decode as a PNG, so OpenLayers marks the tile `ERROR` and
never retries it: a hole until something rebuilds the layer. nginx cannot catch
it either, since `proxy_next_upstream` sees only status codes. The one defence
is fewer requests.

- One tile queue per `Map`, shared by every layer: `maxTilesLoading: 48`
  (`src/map/atoms.ts`) against OL's default 16, capped to 8 while animating. A
  cold LiDAR WMS tile takes 3–12 s; the topo WMTS base answers in ~130 ms.
- `preload: 2` on the WMTS base and on the cached cVAT ground, `preload: 0`
  everywhere else — free on a pre-rendered base or on a database of ours,
  ruinous where a miss reaches an on-the-fly renderer. The `/cache/` layers are
  in the second group despite being tiles: `XYZBackgroundLayer` carries
  `preload` per store for exactly that split, because a MapProxy miss is a
  GetMap and a preloaded tile would hold a slot for the length of it.
- 512 px tiles for every layer, `TileWMS` and cached alike, from an explicit
  `TileGrid` on the View's own resolution ladder
  (`src/map/layers/wmsTileGrid.ts`), so tiles never resample and the two tile
  stores are written on the same ladder they are read on. `getWMSTileGrid`
  takes an optional level range for a store holding only some levels — a cVAT
  acquisition passes z12–z15, the national relief z0–z16, since it is a 1 m
  product and deeper than z16 upsamples either way — and still hands over the
  whole resolution array, indexed by absolute z, fenced by `minZoom` and the
  array's end. At 256 px a
  1600×1000 viewport is ~35 tiles per layer per level, and LiDAR project mode
  stacks two WMS layers: 70 requests a zoom step, two steps to the limiter.
  Bytes are a wash, 146 060 for one 512 px hillshade tile against 4 × ~36 800.
  It stays 512×512 on HiDPI: `TileWMS` pins its pixel ratio to 1 unless
  `serverType` is set, and none of these sources sets one.
- `WMS_TILE_CACHE_SIZE = 128`, ~10 screenfuls at 512 px, or OL has nothing to
  borrow while a new level loads; `WMS_Z_DIRECTION = 1`, the coarser of two
  bracketing levels, so the 250 ms zoom animation does not fetch a second ring.
- Every background layer that can reach an upstream needs a `coverageExtent`
  (`{ extent, crs }`, transformed into the layer's `extent`); without one OL
  spans the whole EPSG:25833 projection extent and orders renders over the
  Atlantic. Values are each service's GetCapabilities `<BoundingBox>`, and the
  same numbers appear a second time as each source's `coverage` in
  `mapproxy/mapproxy.yaml` — the app's copy stops the request, MapProxy's stops
  a meta-tile that straddles the edge from asking for open ocean:

  | Source | EPSG:25833 extent |
  |---|---|
  | LiDAR national mosaic + DOM (`LIDAR_COVERAGE_EXTENT_25833`) | `-100275, 6399725, 1150255, 8000275` |
  | `wms.topo` overlay, and `amtskart` | `-127998, 6377920, 1145510, 7976800` |
  | NiB ortofoto mosaic | `-250025, 6299985, 1211155, 8985010` |
  | one LiDAR project, one ortofoto acquisition | its own `bboxLonLat` (EPSG:4326) |

  The per-project cases must use their own box; the services advertise the
  union of everything they hold, which culls almost nothing. The transform
  samples 8 stops per edge — corners only clips the bulge a Norway-sized box
  grows when reprojected out of UTM33. The cVAT ground is the one exception
  that needs it for a different reason: there is no upstream to spare, but the
  acquisition's footprint is what keeps the layer off ground it never covered.
- `hidpi: false` on `TileArcGISRest`; the default scales `SIZE` and `DPI` by
  pixel ratio, quadrupling resampled pixels and doubling the cache keys.
- Ortofoto backgrounds ask for JPEG — 68 kB against 528 kB per 512 px tile over
  Oslo, and the mosaic has no transparency to lose. A single acquisition needs
  transparent gaps and uses `jpgpng`.
- Tiles load through `guardTileSource` (`src/upstream/tileGuard.ts`), which is
  admission control and nothing else — it sets `image.src` exactly as
  OpenLayers' own loader does, unless the breaker below has the origin shut. A
  former `retryBlankTileLoadFunction` retried anything under 800 bytes, and is
  gone: the no-data PNG is deterministic, so it only ever refetched real
  no-coverage tiles at 4 origin requests each. Fix a blank-where-there-is-data
  tile at wmscache, which can see the upstream.

The compare curtain (`src/map/compare/`) is the deliberate exception: a second
full background stack out of the same queue, so a screenful costs about twice
what it normally does. Hence it is a mode you enter and leave, the B stack is
torn down on exit, and it is not persisted to the URL — a shared link must not
put every recipient into double spend on a shared budget.

## When an upstream stops answering

`src/upstream/` is a circuit breaker per external origin, and the ribbon chip
that says one is open. It exists because of what an outage costs without it: on
2026-09-21 every Kartverket height endpoint answered 504 after a flat 30 s —
`proxy_read_timeout`, which does not fail over, because a slow render is
usually a render — and the app kept asking. A screenful is a dozen tiles, each
pan queued a dozen more, the footprint WFS fired up to sixty lookups a viewport
at three tries each, and the reader was told none of it.

**Four origins**, grouped by what fails together rather than by hostname
(`origins.ts`): `hoyde` (`/wms/geonorge/wms.hoyde-*`, `/wfs/geonorge/wfs.hoyde-*`,
`/arcgis/hoydedata/*` and `/cache/lidar-*` — one backend, and they went down as
one), `kartverketCache` (cache.kartverket.no, direct from the browser),
`ra` (`/wms/ra/*`), `nib` (`/wms/nib/*`, `/arcgis/nib/*`, `/cache/flyfoto`).
Matched by URL prefix, so nothing has to be declared per layer.
`/cache/topo-ref*`, `/cache/amtskart` and `/kms/` are deliberately in no origin:
a different renderer, up through that outage, and one layer each.

Putting the two `/cache/` prefixes under the breaker costs something real — a
warm MapProxy tile is blanked during an outage it could have served — and is
still the right side of the trade. A miss holds a 60 s `client_timeout` against
the source, and a screenful of those ties up MapProxy's workers for every layer,
including the ones whose upstream is fine. Revisit it with evidence, not with
the intuition that a cache hit should always be served.

**Tripping.** Three failures net of successes inside a minute. Net, not
consecutive: `proxy_cache_use_stale` serves cached tiles straight through an
upstream 504, so a pan over half-visited ground interleaves hits and failures,
and a rule that zeroed on any success would hold the counter under the
threshold while eleven twelfths of the map stayed blank.

**While open**, no request goes out at all. Tiles are marked `ERROR` without
touching the network (the slot is freed — a tile left `LOADING` holds one of
the 48); `fetchWithin` throws `UpstreamDownError` before fetching, which the
retry loops in `dem.ts`, `flyfoto.ts`, `lidarExtract/run.ts` and the footprint
fan-out short-circuit on rather than sleep between attempts that cost nothing.

**Recovery is measured, not guessed.** A 1×1 GetMap (the coarsest WMTS tile for
cache.kartverket.no) on a 20 → 40 → 80 → 120 s backoff. `status >= 500` is a
failure and everything else, 4xx included, is the service being alive: the whole
mechanism fails open, so a probe URL that goes stale reads as *up* rather than
wedging an origin shut. On success the guarded sources on the map are
`refresh()`ed — OpenLayers caches the `ERROR` state and will not re-request
without it. The backoff only resets after a minute of continuous health, which
is what stops a flapping service re-probing every 20 s forever.

Two cache interactions are load-bearing. The probes are under the 300-byte
`$skip_cache` floor, so they are neither stored in the 25 GB LRU nor answered
from it; and `probeUrl()` puts a cache-buster on the proxied ones besides,
because a probe served stale through `proxy_cache_use_stale … http_504` is the
one failure the breaker cannot recover from. The WMTS probe goes direct to a CDN
that sends `max-age`, so that one carries `cache: 'no-store'` instead.

## Recipe: add an external map source

First decide which chain it belongs on. If every request to it will carry the
same `LAYERS` and `STYLES` — a background ground, an overlay, anything the
reader cannot reconfigure — it is a MapProxy cache, and the recipe is short:

1. In `mapproxy/mapproxy.yaml`, a `sources` entry (url, layers,
   `supported_srs: ['EPSG:25833']`, `concurrent_requests`, `http.client_timeout`,
   a `coverage` from its GetCapabilities, no `on_error`), a `caches` entry on
   `tufteseid25833` with a `meta_size` and an mbtiles filename, and a `layers`
   entry whose `name` is the `/cache/<name>/` segment.
2. Nothing in `Caddyfile`: the one `@tileCache` regexp already routes any
   `/cache/<name>/`.
3. An `XYZBackgroundLayer` config on `/cache/<name>/{z}/{x}/{y}.<fmt>`, with
   `preload: 0` and a `coverageExtent`.
4. A `seeds` task if the coarse levels are worth pre-filling.
5. `docker compose restart mapproxy` — the config is bind-mounted and read at
   startup only.

Otherwise it is parameterized, and it goes on wmscache:

1. In `Caddyfile`, a `handle_path /wms/<host-slug>/*` block that rewrites to a
   unique internal prefix and `reverse_proxy http://wmscache`.
2. In `nginx/wms-cache.conf`, an `upstream` block — the host three times,
   `max_fails=0`, `keepalive`, `keepalive_timeout 20s`.
3. A `location` for that prefix which rewrites into the upstream's own path,
   sets `proxy_pass`, `Host` and `proxy_ssl_name`, and `include`s
   `/etc/nginx/wms-proxy-common.conf` — directives spelled out instead only if
   this upstream needs a different lifetime or timeout.
4. `/wms/<host-slug>/…` as `wmsUrl` in the layer config. No CSP entry.
5. For a background layer, `coverageExtent` from its GetCapabilities.
6. The layer-config half — name union, config file, `infoFormat` — is
   `docs/map-layers.md`.
7. Nothing for the breaker unless the new source is a *fifth* thing that can
   fail on its own: a layer under one of the four prefixes is covered already,
   and one under none of them simply has no breaker, which is the right answer
   for a single overlay. A `/cache/` prefix is a prefix like any other — add it
   to the origin that owns the upstream behind it, or to none.

## Verifying

On the server; the workstation has no docker daemon and cannot reach these
paths.

```
docker compose exec wmscache nginx -T | grep 'read_timeout\|max_fails\|next_upstream'
curl -sI "http://localhost:3030/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=NHM_DTM_TOPOBATHY_25833:skyggerelieff&CRS=EPSG:25833&BBOX=200000,6500000,300000,6600000&WIDTH=512&HEIGHT=512&FORMAT=image/png" | grep -i 'x-cache\|cache-control'
docker run --rm -v tufteseid_wmscache:/c alpine du -sh /c
```

The first prints what nginx loaded rather than what the file says; the second
is MISS then HIT, both `max-age=604800`; the third is the cache on disk. After
changing either file under `nginx/`, `docker compose up -d` is not enough — the
configs are bind-mounted but read only at startup, and the container is not
recreated. Run `docker compose restart wmscache`.

For mapproxy, the same caveat and the same fix (`docker compose restart
mapproxy`):

```
docker compose exec mapproxy mapproxy-util grids -f /mapproxy/config/mapproxy.yaml -g tufteseid25833
curl -s "http://localhost:3030/cache/lidar-dtm/13/<x>/<y>.png" -o a.png
sudo du -sh /site/tufteseid/data/mapproxy
```

The grid dump printing 0.331 m/px at z16 and 5.289 at z12 is the alignment
check against `wmsTileGrid.ts`; rendering the same bbox through
`/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833` and comparing is the visual
one. Then the map itself, watching the network panel: a cold pan should cost one
upstream GetMap per 2×2 or 4×4 block, not one per tile.
