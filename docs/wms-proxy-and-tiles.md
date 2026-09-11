# WMS proxying, caching and tile loading

Everything about how raster/vector map requests leave the browser, get
proxied and cached, and how few of them we're allowed to spend. Read this
before touching `Caddyfile`, `nginx/`, `nib-proxy/`, `src/map/layers/wmsTileGrid.ts`,
or before adding any new external map source.

This part of the project is working well — the constraints below are load-bearing
and were each paid for once. Don't "simplify" them without reading the rationale.

## Services involved

- **nib-proxy** — `node:24-alpine` token-injecting sidecar for Norge i
  bilder (NiB) ortofoto (zero deps). NiB's WMS needs an access token even for
  imagery norgeibilder.no serves anonymously; the token is minted anonymously
  (Referer only) and bound to the requesting IP + referer, so it must be minted
  *and* used server-side. This mints/refreshes it, injects it toward
  `services.norgeibilder.no`, and re-mints on auth failure (including the
  HTTP-200-with-JSON-error case). Only reachable from wmscache on the compose
  network.
- **wmscache** — `nginx:1.27-alpine` reverse proxy + 25 GB disk cache in
  front of every external WMS/WFS/ArcGIS service the SPA uses (Kartverket,
  Riksantikvaren, matrikkel, NiB, hoydedata). Currently fronts six upstreams:
  - `wms.geonorge.no/skwms1/*` — Kartverket theme + LiDAR WMS.
  - `wfs.geonorge.no/skwms1/*` — Kartverket WFS (kulturminner readout,
    LiDAR project footprints). Proxied but **not** cached.
  - `kart.ra.no/wms/*` — Riksantikvaren Kulturminner WMS.
  - `testapi.norgeskart.no/v1/*` — matrikkel (cadastral) WMS.
  - `hoydedata.no/arcgis/rest/services/*` — Kartverket's elevation
    ImageServers. Not another source of shaded tiles: this is the **float
    elevation** path used by the lokalitet terrain tool, see
    `terrain-analysis.md`.
  - the **nib-proxy** sidecar — NiB ortofoto. The only internal upstream,
    and the only one resolved at request time (Docker DNS `127.0.0.11`),
    because a compose service's IP can change on restart.

Caddy exposes each host under a same-origin prefix and rewrites into
the upstream namespace before forwarding:

```
/wms/geonorge/wms.foo    →  wms.geonorge.no/skwms1/wms.foo
/wfs/geonorge/wfs.foo    →  wfs.geonorge.no/skwms1/wfs.foo
/wms/ra/kulturminner2    →  kart.ra.no/wms/kulturminner2
/wms/testapi/matrikkel   →  testapi.norgeskart.no/v1/matrikkel
/wms/nib/ortofoto        →  nib-proxy → services.norgeibilder.no/wms/ortofoto
/arcgis/nib/*            →  nib-proxy → services.norgeibilder.no/arcgis/rest/services/*
/arcgis/hoydedata/*      →  hoydedata.no/arcgis/rest/services/*
```

The WFS prefix goes through a distinct internal alias (`/wfs-skwms1/`) so
it can't collide with the WMS host's `/skwms1/` in nginx. The NiB prefixes
go through `/nib-wms/` and `/nib-arcgis/`, and hoydedata through
`/hoydedata-arcgis/` — same reason, since both ArcGIS upstreams would
otherwise want the same `/arcgis/` path inside nginx.

Cache config at `nginx/wms-cache.conf` (per-upstream `location` blocks)
+ `nginx/wms-proxy-common.conf` (shared cache/timeout/header defaults).
Cache lives on the `wmscache` docker volume with a 25 GB LRU cap. Not
exposed on the host — only reachable from `tufteseid` over the compose
network.

Because everything is same-origin from the browser's POV, none of these
hosts need to appear in the Caddyfile CSP `img-src` / `connect-src`. Each is
narrowed to what the browser actually contacts *itself*. `img-src` is
`'self' data: blob: cache.kartverket.no` — the WMTS tiles are the only images
not fetched same-origin. `connect-src` adds `*.geonorge.no`, `*.norgeskart.no`
and `hoydedata.no` on top of `cache.kartverket.no` (whose GetCapabilities
document is a `fetch()`), the last of them for the ArcGIS identify call in
`src/search/searchApi.ts` — the proxied `/arcgis/hoydedata/*` terrain path is
same-origin and is not what puts that host in the list. So routing a new
upstream through wmscache is never a CSP change; calling one directly from the
browser always is.

## nginx cache behavior (wmscache)

Split across two files:

- `nginx/wms-cache.conf` — shared cache zone, `$skip_cache` map, one
  `upstream` block per host, and one `location` per host with the
  per-host bits (`proxy_pass`, `Host`, `proxy_ssl_name`).
- `nginx/wms-proxy-common.conf` — everything host-independent: cache
  directives, timeouts, TLS 1.2/1.3, header scrubbing. Included from
  each `location`.

Rules that are load-bearing:

- Single 25 GB LRU on `/var/cache/nginx/wms`, `inactive=180d`, shared
  across upstreams. The cache key is the full request URI, which starts
  with a unique per-upstream prefix (`/skwms1/`, `/wms/`, `/v1/`), so
  there's no risk of collision.
- **Static upstream blocks** (`server host:443; keepalive 8;`) — resolved
  once at startup, so no `resolver` directive. Variable-based `proxy_pass`
  leaks HTTP 426 responses back to the browser.
- Per-host `Host` + `proxy_ssl_name` inline in each `location`, plus
  explicit TLS 1.2/1.3 in the common include, so the handshake with each
  upstream (Kartverket istio-envoy, RA MapServer, …) is unambiguous.
- **Skip caching under 300 bytes** (`map` on `$upstream_http_content_length`)
  — keeps the ~100-byte JSON error body and the rate-limit notice out of a
  180-day entry. Don't raise it to exclude no-coverage tiles: those are
  deterministic, cost 0.3–6 s each at the origin, and dominate a zoomed-out
  screen. They must stay cached.
- `proxy_ignore_headers Set-Cookie Cache-Control Expires` — upstreams set
  session cookies that would otherwise disable caching entirely.
- **Retry: each host is listed three times in its `upstream` block on
  purpose.** nginx sets a request's retry budget from the peer count and
  `proxy_next_upstream_tries` can only lower it, so a one-server group gets
  exactly one attempt and `proxy_next_upstream` never fires — no warning, no
  log. Collapsing the duplicates silently disables every retry here.
  `max_fails=0` keeps a burst of upstream errors from marking all three
  peers down at once (`no live upstreams` in the error log).
- `timeout` belongs in the **WFS** location's `proxy_next_upstream` list and
  deliberately **not** in the shared one. The WFS either answers in ~0.25 s
  or hangs forever, so cutting it at `proxy_read_timeout 8s` and retrying is
  free. The WMS renders on the fly and can legitimately take 5–14 s cold; a
  read timeout there means a render still in progress, so retrying would
  abandon it and queue a second one for the same tile.
- `proxy_cache_lock on` — one upstream request in flight per cold key.
- Adds `X-Cache-Status: HIT|MISS|BYPASS` for debugging.
- **Rewrites `Cache-Control` for the browser** (`$tile_cache_control`,
  `public, max-age=604800`, or `no-store` when `$skip_cache` says the body is
  too small to be a map). No upstream sends a usable one, and with no
  validator either the browser's heuristic freshness is zero — without this
  every revisit re-spends the origin's rate budget. A week is safe because
  these come out of a 180-day LRU here anyway.
  - The upstream's own `Cache-Control`/`Expires`/`Pragma` must be **hidden**,
    not merely ignored — `proxy_ignore_headers` only governs nginx's own
    storage decision, and leaving them on the wire gives the browser two
    `Cache-Control` headers, of which it takes the stricter.
  - The `add_header` deliberately has **no `always`**, scoping it to
    successful statuses: a 502/504 from a shed upstream must not go out with
    a week of freshness. The rate-limit case is still covered because it
    arrives as a 200 and `$skip_cache` catches it on length.

### NiB sidecar routing

A request path starting `/arcgis/` goes to `NIB_REST_UPSTREAM`
(`…/arcgis/rest/services`), everything else stays on `UPSTREAM` (`…/wms`). That
marker is what disambiguates them — after the prefix rewrites a WMS request is a
bare service name like `/ortofoto`, which is otherwise indistinguishable from the
head of a REST path.

Two nginx locations, because the two endpoints want different lifetimes:
`/nib-arcgis/prosjekter/` is spelled out with `proxy_cache_valid 200 7d` (the
catalogue *grows* — a new acquisition a few times a year would otherwise be
hidden for 180 days), while `/nib-arcgis/` takes the shared include's 180d
(a completed acquisition's pixels never change). Longest-prefix wins, so the
order in the file is not what selects them.

The token is injected in a request *header*
(`X-Esri-Authorization: Bearer`), never in the URL, so wmscache keys stay stable
as the token rotates and the token never reaches the browser. NiB accepts the
token as either that header or a `&token=` query param (fallback if the header
form is ever rejected; still cache-safe because injection is server-side).

**The sidecar also fixes NiB's Content-Type.** `ortofoto_prosjekter/ImageServer`
is asked for `format=jpgpng` — JPEG where the acquisition has coverage, a
~1 kB transparent PNG where it doesn't — and labels every one of them
`application/octet-stream`, because it only knows which it produced after
producing it. Caddy sets `X-Content-Type-Options: nosniff` globally, so an
`<img>` refuses to paint that. The handler buffers anything whose type isn't
already `image/*`, checks the magic bytes for JPEG/PNG and re-labels; a real
non-image (GetCapabilities XML, a GetFeatureInfo body, an auth error) falls
through unchanged. It has to happen here rather than in the browser, and here
is also upstream of wmscache, so the corrected type is what gets stored.

Asking for a single format instead is not an option: `jpg` paints the
no-coverage gaps opaque black, and `png32` is eight times the bytes for the
same pixels (measured on one 512 px tile over Oslo: 68 kB vs 555 kB). The
transparent no-coverage PNG is 1097 bytes, comfortably over `$skip_cache`'s
300-byte floor, so those tiles do get cached.

### Verifying

Verify what nginx actually loaded, not what the file says:

```
docker compose exec wmscache nginx -T | grep 'read_timeout\|max_fails\|next_upstream'
```

Sanity check after a rebuild (LiDAR hillshade):

```
curl -sI "http://localhost:3030/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=NHM_DTM_TOPOBATHY_25833:skyggerelieff&CRS=EPSG:25833&BBOX=200000,6500000,300000,6600000&WIDTH=512&HEIGHT=512&FORMAT=image/png" | grep -i 'x-cache\|cache-control'
```

First call: `MISS`. Repeat: `HIT`. Both should carry
`Cache-Control: public, max-age=604800`. Inspect on-disk size:
`docker run --rm -v tufteseid_wmscache:/c alpine du -sh /c`.

Reminder: if `nginx/wms-cache.conf` or `nginx/wms-proxy-common.conf` changed,
`docker compose up -d` is not enough — the configs are bind-mounted but nginx
only reads config at startup and the container isn't recreated (image tag
unchanged), so `docker compose restart wmscache`. Symptom of forgetting:
same-origin proxy paths (e.g. `/wms/ra/...`) return nginx's default 404 page
even though the Caddyfile and layer configs look correct.

## Tile-loading constraints

The whole app's map performance rests on spending *few* WMS requests. Four
things enforce that; none of them is cosmetic.

**Kartverket rate-limits with an HTTP 200.** `wms.geonorge.no` meters GetMap
by source IP — the server, so the budget is shared by every visitor at once.
Over it the reply is HTTP 200, `Content-Type: application/vnd.ogc.se_xml`,
238 bytes ("Overforbruk på kort tid"). The browser can't decode it as a PNG,
so OpenLayers marks the tile `ERROR` — and **an errored tile is never
retried**; it stays a hole until something rebuilds the layer. (That's the
cause of the classic "patchwork of zoom levels": `findAltTiles_` filling
holes.) It's a short-window *volume* budget of roughly 120 GetMaps, not a
concurrency limit, and nothing in nginx can retry it — `proxy_next_upstream`
only sees status codes. The only defence is fewer requests.

*The one deliberate exception* is the compare curtain
(`src/map/compare/`, `docs/ui-architecture.md` §5.8): it puts a second full
background stack on the map, so a screenful costs roughly twice what it
normally does, and the two stacks share the one tile queue below. That is why
Sammenlign is a mode you enter and leave rather than a persistent split, why
the B stack is torn down on exit, and why it is not persisted to the URL — a
shared link must not put every recipient into double spend on a budget the
whole deployment shares. Its layers are otherwise ordinary background layers
and get every mitigation below, `coverageExtent` culling included.

**One tile queue per `Map`, shared by every layer.** OL won't start a tile
while `maxTilesLoading` are in flight (default 16, hard-capped to 8 during
animation). A cold LiDAR WMS tile takes 3–12 s against Kartverket while the
topo WMTS base answers in ~130 ms, so a screenful of hillshade otherwise
pins every slot and the base map never gets scheduled. Three settings keep
the fast layer from queueing behind the slow one:

- `maxTilesLoading: 48` on the `Map` (`src/map/atoms.ts`).
- `preload: 0` on WMS background layers vs `preload: 2` on the WMTS base
  (`backgroundLayers/utils.ts`). Preloading coarser levels is free on a
  pre-rendered base and ruinous on an on-the-fly renderer.
- wmscache caching no-data tiles, so the no-coverage majority of a
  zoomed-out view is a ~5 ms hit.

**512 px WMS tiles.** `src/map/layers/wmsTileGrid.ts` gives every `TileWMS`
in the app — background *and* theme — an explicit 512 px `TileGrid` whose
resolutions are the View's own ladder (`max(width, height) / 256 / 2**z` over
the projection extent, mirroring `View`'s `createResolutionConstraint`), so
alignment is exact and tiles never resample. At OL's default 256 px a
1600×1000 viewport is ~35 tiles per layer per level and LiDAR project mode
stacks two WMS layers — 70 requests per zoom step, which trips the
interceptor in two steps. It is not a bandwidth trade: one 512 px tile is
about the same total bytes as the four it replaces, and fewer tiles means
fewer chances to draw a long-tail slow one.

Two things to know before changing the size: the request stays 512×512 on
every display because `TileWMS` pins its pixel ratio to 1 unless `serverType`
is set and none of these sources sets one (set one and it will start asking
for 1024×1024 — both origins serve that fine). And projections without an
extent get `undefined` back and stay on OL's default grid.

The same module sets `cacheSize: 128` (~10 screenfuls at 512 px; OL's 512
default was budgeted for quarter-size tiles) and `zDirection: 1`.
`zDirection: 1` asks for the coarser of two bracketing levels; at rest it
does nothing (`constrainResolution` means the view settles on an exact
match), but during the 250 ms zoom animation it stops a one-notch zoom-out
from also fetching a ring at the level it's leaving.

Not done, and not worth trying: raising `MouseWheelZoom`'s `timeout` to
coalesce wheel notches. With `constrainResolution` on, `handleWheelZoom_`
already collapses a burst inside the window to exactly one level (delta
clamped to ±1), so a longer timeout skips no intermediate levels — it only
caps how fast the user can zoom.

**Every WMS background layer needs a `coverageExtent`.** A `TileWMS` with no
tile grid of its own takes one spanning the whole *projection* extent, and
EPSG:25833 reaches far past Norway — zoomed out, OL asks the LiDAR renderer
for full on-the-fly renders over the Atlantic, Denmark and western Russia.
`coverageExtent` on `WMSBackgroundLayer` (`{ extent, crs }`, transformed to
the view projection in `getWMSLayer`) becomes the layer's `extent` and OL
culls those tiles before a request goes out. Values come from each service's
GetCapabilities `<BoundingBox>`:

- national mosaic + the DOM one: `LIDAR_COVERAGE_EXTENT_25833`
  (`-100275, 6399725, 1150255, 8000275`).
- `wms.topo` overlay: `-127998, 6377920, 1145510, 7976800`.
- per-project: **the project's own `bboxLonLat`**, not the service's.
  `wms.hoyde-dtm-prosjekt` advertises the union of all 1936 acquisitions
  (Jan Mayen to Svalbard), which culls almost nothing.
- NiB ortofoto mosaic (`/wms/nib/ortofoto`): `-250025, 6299985, 1211155,
  8985010`.
- one ortofoto acquisition: again **the acquisition's own `bboxLonLat`**,
  off `FlyfotoProject`. One flight covers a town while the ImageServer
  advertises every flight ever flown.

The same applies to the one non-WMS background source. `ArcGISImage` layers
(`getArcGISImageLayer`) are on `ol/source/TileArcGISRest` but get the identical
treatment — same 512 px grid, same `zDirection`, same `preload: 0`, same
`coverageExtent` culling — because an ImageServer renders on the fly exactly
like a WMS does. One extra setting there: `hidpi: false`. Left at its default
`true`, `TileArcGISRest` scales `SIZE` and `DPI` by the map's pixel ratio,
which on a HiDPI screen quadruples the pixels the service resamples *and*
gives wmscache a second set of cache keys for the same ground.

The transform uses 8 sampling stops per edge. Corners-only would clip the
bulge a Norway-sized box grows when reprojected out of UTM33, cutting *real
coverage* off the map — worse than requesting a few extra tiles.

**Ortofoto backgrounds ask for JPEG, not PNG.** Measured on one 512 px tile
over Oslo the same pixels are 68 kB as JPEG and 528 kB as PNG, and a live
background spends that per tile per pan. The seamless mosaic has no
transparency to lose (it is opaque across its whole advertised extent, and
nothing is stacked under it), so `FORMAT=image/jpeg` is free. A single
acquisition can't use plain JPEG — it needs transparent gaps — and uses
`jpgpng` instead; see the sidecar's Content-Type note above.

**Tile loading is OpenLayers' default — don't make it custom again.** There
was a `retryBlankTileLoadFunction` that `fetch()`ed every tile with
`cache: 'no-store'` and retried anything under 800 bytes, on the theory that
the DTM WMS sometimes returns a tiny transparent PNG instead of hillshade.
The no-data PNG is deterministic (byte-identical across requests for a fixed
BBOX), so retrying returns the same bytes; the only tiles it ever retried
were legitimate no-coverage ones, turning each into 4 origin requests and
~12 s in `LOADING`, and `no-store` defeated the browser HTTP cache for every
LiDAR tile. If a blank-where-there-is-data tile ever *is* observed, fix it at
wmscache (which can see and retry the upstream), not in a client loader.

## Adding a new external map source

Route requests through `wmscache` instead of hitting the origin from the
browser. Add a `handle_path /wms/<host-slug>/*` block in `Caddyfile` that
rewrites to the upstream's WMS path prefix, plus an `upstream` + `location`
pair in `nginx/wms-cache.conf`, and use `/wms/<host-slug>/...` as `wmsUrl` in
the layer config. This gives you the 25 GB LRU disk cache and same-origin
browser requests for free (no CSP entry needed).

For a background layer, also set `coverageExtent` from the service's
GetCapabilities `<BoundingBox>` (see above).

That is the transport half of the recipe. The layer-config half — which name
union the id goes in, where the config file lives, how it reaches
`allConfiguredBackgroundLayers` or the exported `themeLayerConfig`, `infoFormat`
for GetFeatureInfo, and the ribbon control it needs — is in
`docs/map-layers.md`, which also catalogues every source already wired up.
