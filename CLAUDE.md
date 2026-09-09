# Tufteseid — armchair archaeology on Norwegian public data

Map viewer tailored for reading Norwegian LiDAR terrain against the
Riksantikvaren heritage register (Kulturminner). Hard fork of
Kartverket's Norgeskart — not tracking upstream. Working branch:
`main`.

Not affiliated with Kartverket or Riksantikvaren; the app is
de-branded from upstream on purpose, so don't reintroduce Norgeskart
naming or Kartverket's visual identity in user-visible strings, page
titles, export filenames or assets. Attribution belongs in prose (the
"Om oss" text, README, LICENCE), not in the chrome.

Feature scope is deliberately narrow: keep what an amateur reading
relief-shaded terrain against the heritage record needs (Kulturminner
theme layers, LiDAR hillshade + per-project LiDAR backgrounds, LiDAR
tile extract, lokaliteter with their drawing and imagery,
place/property search), drop the rest. If you're tempted to re-add an
upstream Norgeskart feature, ask whether this specific use case needs
it before wiring it back in.

## Deploy

Runs as a Docker Compose stack **on a separate server**. The working copy you
see is the user's workstation: it has no docker daemon and does not run the
stack, so `docker compose ...`, `curl localhost:3030`, and container logs are
all unavailable locally. Print the commands for the user to run on the server
instead. Same for the build toolchain — **do not run `npm run build` / `tsc`
locally**; TypeScript errors surface in the docker build output instead.

That also means the app's own proxy paths (`/wms/nib/...`, `/wms/geonorge/...`)
can't be probed from here. Public upstreams *can* be reached directly over the
internet, and that includes the NiB ones: the anonymous token is bound to the
IP that minted it, so a workstation can mint one and use it itself. What it
can't do is mint a token the server would accept, or the reverse — so a token
is never worth carrying between the two, just mint a fresh one wherever the
call is being made.

`README.md` is the third-party-facing install and admin guide (first-run
PocketBase setup, OAuth, TLS, backup, troubleshooting). Keep it accurate
when any of that changes.

Standard rebuild on the server:

```
git pull
docker compose build --pull tufteseid
docker compose up -d
docker compose logs -f tufteseid wmscache
```

If `nginx/wms-cache.conf` or `nginx/wms-proxy-common.conf` changed, also
`docker compose restart wmscache` — the configs are bind-mounted, but nginx
only reads config at startup and `docker compose up -d` doesn't recreate the
container (image tag unchanged). Symptom of forgetting: same-origin proxy
paths (e.g. `/wms/ra/...`) return nginx's default 404 page even though the
Caddyfile and layer configs look correct.

Same gotcha for **pocketbase** after adding/changing a migration in the
bind-mounted `pocketbase/pb_migrations/`:

```
docker compose restart pocketbase
docker compose logs pocketbase   # confirm the migration applied
```

Symptom of forgetting: API calls against the new/changed collection 404,
which the SPA may surface only in the browser console (e.g. "Ny lokalitet"
appearing to do nothing).

Migration ordering: PocketBase applies **all** of its built-in Go migrations
during bootstrap and only then registers the JS ones from `pb_migrations/`,
whatever the timestamps say. A JS migration can therefore never run before a
core one; anything that has to precede a core migration has to happen out of
band, against a stopped database.

Ports: Caddy inside the container listens on `:3000`; docker-compose maps host
`3030 → container 3000`.

## Services (docker-compose.yml)

- **tufteseid** — multi-stage Dockerfile: `node:24-alpine` builds the SPA,
  then `caddy:2.10.0-alpine` serves `/var/www` with the baked-in `Caddyfile`.
  `config.js` is bind-mounted at runtime.
- **pocketbase** — backend for lokaliteter (auth + user content). Small
  in-repo Dockerfile that pins a PocketBase release from GitHub. Serves the
  SPA's `/pb/*` API (auth, the `localities` / `finds` / `attachments`
  collections, file storage, realtime). SQLite state on the `pbdata`
  volume; schema versioned in `pocketbase/pb_migrations/`. First-run setup
  is in README.md. Pinned to 0.40.2 — migrations use the ≥0.23 App-based
  JSVM API (`$app.findCollectionByNameOrId` / `app.save`, flattened field
  classes), *not* the 0.22 `Dao` API.
- **nib-proxy** — `node:24-alpine` token-injecting sidecar for Norge i
  bilder (NiB) ortofoto (zero deps; see the "Flyfoto" section below).
  NiB's WMS needs an access token even for imagery norgeibilder.no serves
  anonymously; the token is minted anonymously (Referer only) and bound to
  the requesting IP + referer, so it must be minted *and* used server-side.
  This mints/refreshes it, injects it toward `services.norgeibilder.no`, and
  re-mints on auth failure (including the HTTP-200-with-JSON-error case).
  Only reachable from wmscache on the compose network.
- **wmscache** — `nginx:1.27-alpine` sidecar. Reverse-proxies + caches
  every external WMS the SPA uses. Currently fronts five upstreams:
  - `wms.geonorge.no/skwms1/*` — Kartverket theme + LiDAR WMS.
  - `wfs.geonorge.no/skwms1/*` — Kartverket WFS (kulturminner readout,
    LiDAR project footprints). Proxied but **not** cached.
  - `kart.ra.no/wms/*` — Riksantikvaren Kulturminner WMS.
  - `testapi.norgeskart.no/v1/*` — matrikkel (cadastral) WMS.
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
  ```

  The WFS prefix goes through a distinct internal alias (`/wfs-skwms1/`) so
  it can't collide with the WMS host's `/skwms1/` in nginx. The NiB prefix
  goes through `/nib-wms/`.

  Cache config at `nginx/wms-cache.conf` (per-upstream `location` blocks)
  + `nginx/wms-proxy-common.conf` (shared cache/timeout/header defaults).
  Cache lives on the `wmscache` docker volume with a 25 GB LRU cap. Not
  exposed on the host — only reachable from `tufteseid` over the compose
  network.

  Because everything is same-origin from the browser's POV, none of these
  hosts need to appear in the Caddyfile CSP `img-src` / `connect-src`.

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

The transform uses 8 sampling stops per edge. Corners-only would clip the
bulge a Norway-sized box grows when reprojected out of UTM33, cutting *real
coverage* off the map — worse than requesting a few extra tiles.

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

## Added map content

### Kulturminner (theme layers, Riksantikvaren)

Config: `src/map/layers/config/themeLayers/culturalHeritage.ts`. Registered
in `themeLayerConfigApi.ts` (added to `configs` array) and the layer id
union in `themeWMS.ts` (`CulturalHeritageLayerName`).

Five layers under the "Kulturminner" theme category (groupid 19), one per
Riksantikvaren WMS service. URLs are same-origin (`/wms/ra/<name>`) and
routed through `wmscache` to `kart.ra.no/wms/<name>`: `kulturminner2`
(sites + monuments), `kulturmiljoer`, `sefrak`, `freda_bygninger`,
`brukerminner`.

Feature-info: the category sets `infoFormat: 'application/vnd.ogc.gml'` so
the existing `parseXmlFeatureInfo` (which handles MapServer `msGMLOutput`)
kicks in and shows structured fields. Left unset, the WMS returns HTML,
which the parser wraps as `{ _html: ... }` and the UI shows an unhelpful
"HTML-respons mottatt" placeholder.

### LiDAR hillshade (background layer, Kartverket)

Sits in the "Kart" (bottom-right) menu, not "Temakart", because the intent is
to overlay Kulturminner objects on top of the terrain relief.

- Type registered in `src/map/layers/backgroundLayers.ts` (`lidarHillshade`
  in `WMSLayerName`).
- Config: `src/map/layers/config/backgroundLayers/elevation.ts`. Registered
  in `allConfiguredBackgroundLayers` (`atoms.ts`).
- Ordering: entry in `backgroundLayerOrder` in
  `src/map/backgroundLayer/utils.ts`.
- Thumbnail: **still falls back** to `topograatone.png` via a case in
  `getBackgroundLayerImageName` in `src/map/atoms.ts`. Drop a real
  `lidarHillshade.png` in `public/backgroundlayerImages/` and remove that
  case when a proper thumbnail is available.
- Translations: `lidarHillshade` in `backgroundMaps` in
  `src/locales/{nb,nn,en}/translation.json`.

The client hits `/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833`, not
`wms.geonorge.no` directly — same-origin through wmscache, which also avoids
the CORS issues seen calling `wms.geonorge.no` from `fetch()`. Same treatment
for per-project LiDAR at `/wms/geonorge/wms.hoyde-dtm-prosjekt` (see
`lidarProjects.ts`).

### The background stack

`backgroundLayerAtomEffect` builds a stack, bottom-first, not a single layer:

1. topo base (both LiDAR modes — the LiDAR WMS returns transparent PNGs
   outside coverage);
2. the national mosaic at `LIDAR_FALLBACK_OPACITY`, when a *per-project*
   dataset is active, so the area the project doesn't cover keeps its relief
   instead of dropping to plain topo;
3. the active dataset;
4. the topo overlay, in hybrid mode.

`swapBackgroundLayers(under, over)` (`backgroundLayers/utils.ts`) swaps that
stack in without ever showing a gap. The split matters: 1–2 go *under* the
outgoing layers (context the fading dataset should keep covering), 3–4 go
*over* them, or the layer on its way out buries the one coming in.

- Outgoing layers are **not** removed up front — they're dimmed to
  `OUTGOING_OPACITY` immediately and removed on the next map
  `rendercomplete` (8 s timeout as a backstop). Tearing down first made every
  step of a W/S or A/D cycle flash topo while the new hillshade loaded; the
  instant dim is what makes the incoming dataset's coverage edge readable
  before its tiles are in.
- `buildOrReuseBackgroundLayer` keeps an existing layer whose signature
  (url + params + projection) matches, so cycling only rebuilds the layer
  that changed. Reused layers may still carry an earlier fade, so the effect
  sets opacity explicitly on every layer it passes in.

### Hybrid mode

Third mode button next to Standard and LiDAR: the same LiDAR stack with
Kartverket's roads/railways/place-names drawn transparently on top, for
working out *where* a feature is without leaving the terrain. State is
`hybridOverlayAtom` (a modifier on the background, not a background of its
own — dataset, style and W/S + A/D cycling all keep working), persisted as
`?hybrid=true`.

Config: `backgroundLayers/topoOverlay.ts` — `/wms/geonorge/wms.topo` with
`LAYERS=kd_veger,kd_jernbane,kd_stedsnavn,fkb_samferdsel,`
`fkb_presentasjonsdata` and `TRANSPARENT=TRUE`. Asking that WMS for a subset
of its groups yields a real overlay: no terrain, no landcover, no background
fill. Both families are needed — the generalized `kd_*` groups stop rendering
around 1:25 000 and the `fkb_*` ones take over.

Alternatives already ruled out: `cache.kartverket.no`'s WMTS has no
transparent overlay layer (only full basemaps), `wms.topo4` is dead, and NiB
needs an API token.

### DTM vs DOM

Both the national mosaic and the per-project service exist in a terrain
(DTM) and a surface (DOM) flavour. `activeLidarModelAtom`
(`lidarProjects.ts`) picks between them; persisted as `?lidarModel=dom`,
absent means DTM. A `DTM | DOM` segment next to the style chip, bound to `E`,
switches it — like hybrid it's a modifier, not a fourth mode, so the dataset
picker and W/S cycling are unaffected.

URL pairs live in `LIDAR_PROJECT_WMS_URL` and `NATIONAL_WMS`
(`wms.hoyde-dom-prosjekt` / `wms.hoyde-dom-nhm-25833`, layer prefix
`NHM_DOM_25833`). Both go through `wmscache`.

- The DTM and DOM per-project catalogues are **identical** (same 1936 project
  names, verified by diffing both GetCapabilities), so `fetchLidarProjects()`
  stays a single fetch and the footprint/relevance/picker machinery is
  model-independent.
- DOM publishes exactly one usable style, `skyggerelieff`, for every project.
  `DOM_STYLES` is therefore a hard-coded constant, and `stylesForModel` /
  `effectiveLidarStyle` clamp to it. The clamp isn't cosmetic: asking a DOM
  layer for a DTM-only style (`helning_prosent`) fails silently — HTTP 200,
  `Content-Type: image/png`, a ~100-byte JSON body the browser gives up on as
  a broken image, i.e. a blank map with nothing in the console.
  `activeLidarStyleAtom` keeps holding the user's DTM pick while in DOM mode
  so it comes back on the way out, which is why A/D is a deliberate no-op
  there rather than walking a one-entry ring over the top of it.

The LiDAR *extract* tool stays DTM-only (`lidarExtract/sources.ts` pins
`LIDAR_PROJECT_WMS_URL.dtm`): an extract is meant to be read as terrain.

### Keyboard cycling of the LiDAR pulldowns

`TopBar.tsx` binds A/D to the style pulldown and W/S to the dataset pulldown,
top-tier entries only (not what's behind "flere stiler" / "mindre
relevante"), wrapping at both ends, plus E for the DTM/DOM segment. None of
them open a pulldown — cycling should leave the terrain unobstructed, which
also means no footprint polygons.

Hence two flags rather than one: `lidarPickerOpenAtom` decides whether
footprints are *drawn*, while `lidarCyclingAtom` (armed by W/S, expires 90 s
after the last press or on leaving LiDAR mode) keeps the viewport list
*fetched*. The project ring is that list, so the first W/S press after a
pause only starts the WFS fetch — the dataset chip shows a spinner meanwhile
— and the next press walks it.

### Flyfoto (Norge i bilder ortofoto)

A lokalitet's "Flyfoto" action (`LocalityWorkspace.tsx`) stitches NiB
ortofoto over the authored bbox and saves it as an attachment of kind
`flyfoto`. (The TopBar "Flyfoto ↗" external-link button is unrelated and
still there.)

The stitch (`src/localities/flyfoto.ts`) reuses the LiDAR extract machinery
(`planTiles` / `fetchAndPaint` / `runWithConcurrency` from
`src/lidarExtract/stitch.ts`) — WMS 1.3.0 GetMap, EPSG:25833, JPEG, target
0.2 m/px, per-tile retry. `fetchAndPaint`'s uniform-image check drops
no-coverage tiles, so a bbox entirely outside coverage returns null and the
UI says so.

Request path is same-origin like every other raster source:
`/wms/nib/ortofoto` → Caddy → wmscache → **nib-proxy** →
`services.norgeibilder.no/wms/ortofoto`. The token is injected by the sidecar
in a request *header* (`X-Esri-Authorization: Bearer`), never in the URL, so
wmscache keys stay stable as the token rotates and the token never reaches
the browser. Old NiB WMS endpoints die **Sep 2026**; this uses the new
`services.norgeibilder.no/wms/*`.

Verified against the running service: the WMS namespace is
`services.norgeibilder.no/wms/*` (the sidecar's `UPSTREAM` ends in `/wms`
because the Caddy+nginx prefix rewrites strip the request down to the bare
service name, e.g. `/ortofoto`, before it reaches the sidecar — a bare-host
base 404s), the layer name is `ortofoto` (`FLYFOTO_LAYER`), and NiB accepts
the token as **either** the `X-Esri-Authorization: Bearer` header (what the
sidecar sends) **or** a `&token=` query param (fallback if the header form is
ever rejected; still cache-safe because injection is server-side).

Licensing: NiB imagery is free for private, non-commercial use;
publishing/commercial use is the user's responsibility. A notice dialog gates
every grab (`localities.tools.flyfotoNotice*`), by deliberate product
decision — this facilitates personal use, akin to hitting print. Attribution
lives in that prose, not the chrome.

`attachments.kind` includes `flyfoto` (migration
`1700000300_attachments_flyfoto.js`; `AttachmentKind` in
`src/api/attachments.ts`; `KIND_ICON` in `BilderSection.tsx`).

#### Per-project flyfoto (every acquisition covering a lokalitet)

Built. v1 grabs the single seamless **best mosaic** (`LAYERS=ortofoto`); on top
of that the "Flyfoto" action now offers a temporal stack — every ortofoto
acquisition intersecting the lokalitet bbox, the same ground in 1937, 1963 and
2024, each stitched as its own `flyfoto` Bilde.

**Discovery overturned the two-service model this section used to plan for.**
Both halves live on NiB, and neither is a WMS:

| Purpose | Service | Proxy path |
|---|---|---|
| Which acquisitions cover here | `prosjekter/MapServer/4/query` (layer 4 = "Prosjektomriss prosessert") | `/arcgis/nib/` |
| The imagery pixels for one of them | `ortofoto_prosjekter/ImageServer/exportImage` | `/arcgis/nib/` |
| The seamless mosaic (v1, unchanged) | `services.norgeibilder.no/wms/ortofoto` | `/wms/nib/` |

Three findings worth not re-deriving:

- **`wms.georef_nib` is the wrong index — do not go back to it.** The name
  makes it look like the coverage register, but it is a *planning* layer:
  GetFeatureInfo returns `prosjektfase` P/U with `r_pstart` in the future
  (2026–2028) and the `prosjektna` / `nib_navn` fields **empty**. It describes
  photography not yet flown. There is also no NiB WFS on geonorge
  (`wfs.nib`, `wfs.georef_nib` → "UKJENT APPLIKASJON").
- **Per-project imagery is not reachable over WMS at all.** `/wms/ortofoto`
  publishes only the merged `ortofoto` layer, and `/wms/ortofoto_prosjekter`
  403s — that service has no WMS endpoint. Selection happens instead through
  the ImageServer's mosaic catalogue, which carries a `prosjektnavn` column:
  `exportImage?...&mosaicRule={"mosaicMethod":"esriMosaicNone","where":`
  `"prosjektnavn='Oslo 1937'"}`. `esriMosaicNone` matters — the service's
  default method would blend other projects back in.
- **The join is free.** `prosjektnavn` is the same column in the same database
  behind both the footprint layer and the ImageServer catalogue, so there is
  no name matching between index and renderer to get wrong.

Also ruled out while probing: `returnDistinctValues=true` on the ImageServer
`/query` silently returns zero features, and an undistinct catalogue query
returns one row *per raster tile* (1000 rows / 24 MB for an Oslo-sized bbox),
which is why enumeration uses the `prosjekter` MapServer instead — 121
projects in ~25 KB for the same bbox.

**Infra.** The sidecar grew a second base: a request path starting `/arcgis/`
goes to `NIB_REST_UPSTREAM` (`…/arcgis/rest/services`), everything else stays
on `UPSTREAM` (`…/wms`). That marker is what disambiguates them — after the
prefix rewrites a WMS request is a bare service name like `/ortofoto`, which is
otherwise indistinguishable from the head of a REST path. Chain:
`/arcgis/nib/*` (Caddy) → `/nib-arcgis/*` (nginx) → `/arcgis/*` (sidecar).

Two nginx locations, because the two endpoints want different lifetimes:
`/nib-arcgis/prosjekter/` is spelled out with `proxy_cache_valid 200 7d` (the
catalogue *grows* — a new acquisition a few times a year would otherwise be
hidden for 180 days), while `/nib-arcgis/` takes the shared include's 180d
(a completed acquisition's pixels never change). Longest-prefix wins, so the
order in the file is not what selects them.

**Client.** `src/localities/flyfotoProjects.ts` — `FlyfotoProject { id
(= prosjektnavn, the imagery selector), projectName, year, photoDate,
metresPerPx, bboxLonLat }` and `fetchFlyfotoProjectsForBbox(bbox4326)`, newest
first. The spatial filter runs server-side against real footprint polygons, not
envelopes. `ortofototype = 6` ("Satellittbilde") is filtered out: those are the
nationwide 10 m Sentinel-2 mosaics, which cover everywhere and are useless next
to 0.1 m aerial photography. No localStorage cache — wmscache fronts the query.

`fetchFlyfoto(bbox, { project?, signal? })` switches `buildUrl` between the WMS
mosaic and `exportImage`; everything downstream (planTiles / fetchAndPaint /
retry / blank-drop) is unchanged. It also clamps resolution to the project's own
`pixelstorrelse` when that is coarser than the 0.2 m target — upsampling a 1937
flight to 0.2 m is four times the tiles for the same detail.

**UX:** "Flyfoto" → licensing notice → picker listing the mosaic plus every
covering acquisition (label = year, subtitle = photo date + project name), each
with "Hent", plus "Hent alle" over the newest `FLYFOTO_BATCH_MAX` (8). The batch
runs **sequentially** — one project's tile burst already saturates
`MAX_CONCURRENT` against the shared NiB edge — and reports how many of the
attempted projects actually had coverage, since `fetchAndPaint`'s uniform-image
check drops all-blank ones. `meta` records `projectName` / `year` / `photoDate`
so the gallery captions "Flyfoto 1937". No new map layer or footprints — it
stays a workspace action, out of the `MapTool` union like `takeScreenshot`.


## Lokaliteter (user content)

The top-level user object is **an area to explore**, not a claim that
something is there — mirroring Riksantikvaren's lokalitet → enkeltminne
hierarchy. A lokalitet is an authored rectangle (created with one box-drag,
resizable afterwards) holding *funn* (individually named and addressable
drawn features) and *bilder* (kept LiDAR extracts, map screenshots, uploads).

Consequences worth remembering before changing anything here:

- Drawing and LiDAR extract exist **only** inside a lokalitet workspace. The
  route to those tools is creating a lokalitet; there are no standalone
  `draw` / `lidarExtract` / `newFind` map tools. Measure stays global because
  it's ephemeral.
- The bbox is authored, never derived from content. If a drawn funn escapes
  the rectangle the workspace offers to grow it.
- All lokalitet content is behind sign-in, including `public` ones — the read
  rules require `@request.auth.id != ""`. The map itself stays publicly
  browsable.
- `limited` visibility is a placeholder that behaves as `private` until
  groups exist.

Key files:

- `src/api/pocketbase.ts` — singleton PB client (`pocketbaseUrl` from env,
  defaults `/pb`).
- `src/api/localities.ts`, `localityFinds.ts`, `attachments.ts` — CRUD +
  realtime per collection. Attachment files are `protected`, so the client
  fetches short-lived file tokens for thumbnails.
- `src/api/kulturminnerWfs.ts` — the "kjente kulturminner her" readout.
  kart.ra.no has WFS disabled, so this goes to GeoNorge's redistribution
  (`wfs.kulturminner`, feature type `app:Lokalitet`, GML 3.2 only,
  DOM-parsed).
- `src/auth/` — atoms (currentUserAtom, roleAtom, isAdminAtom), hooks
  (useOAuthProviders, useSignIn, useSignOut), AuthButton + AuthDialog.
- `src/localities/` — `LocalityWorkspace` (the docked panel: header, Funn,
  Bilder, Verktøy), `LocalitiesPanel` (the `localities` map tool),
  `localityLayer` / `funnLayer`, `useLocalityCreate`, `useLocalityAdjust`,
  `screenshot.ts`, `serializeDrawLayer.ts`.
- `pocketbase/pb_migrations/1700000200_localities.js` — current schema.
  `1700000000` adds `users.role`, `1700000100` relaxes it. **Leave the
  filenames alone** — they're recorded in `_migrations`, so renaming one
  makes PB re-run it. Collection ids must not equal any collection name
  (0.23+ rejects that), hence `pbc_localities` / `finds2` /
  `pbc_attachments`.

The workspace is driven by `activeLocalityAtom`, deliberately *not* by the
`MapTool` union (`'layers' | 'measure' | 'localities' | null`), so a map tool
and an open workspace can't fight over the same slot.

Data model:

- **`localities`** — `owner` (relation → users, cascade), `name`,
  `description`, `visibility` (private | limited | public), `bbox` (json,
  `[minLon, minLat, maxLon, maxLat]` EPSG:4326).
- **`finds`** — `locality` (relation, cascade), `owner` (denormalized so
  rules stay cheap), `title`, `note`, `status` (mulig | sannsynlig |
  avkreftet | rapportert), `geometry` (json GeoJSON FeatureCollection,
  EPSG:4326 — Circles round-trip as 64-gons).
- **`attachments`** — `locality`, `owner`, `kind` (extract | screenshot |
  upload | flyfoto), `file` (protected, ≤20 MB, png/jpeg/webp, thumbs),
  `caption`, `meta` (json: source key/label, style, metresPerPx, bbox).

Rules (server-enforced by PB), same shape on all three:

- read: signed in **and** (own it, or its lokalitet is public, or
  `@request.auth.role = "admin"`)
- create: signed in, owns the record, and owns the parent lokalitet
- update/delete: owner or admin

Adding an OAuth provider: PB admin UI → Collections → `users` → Edit
collection → Options → OAuth2 (since 0.23 the providers live on the auth
collection, not in global settings). No code change needed — the SPA's
AuthDialog lists whatever is enabled via
`pb.collection('users').listAuthMethods()`, reading `oauth2.providers`.

## Adding another theme layer

1. Create a config file in `src/map/layers/config/themeLayers/`. Export a
   `ThemeLayerConfig` with `categories[]` and `layers[]`. Category holds
   shared defaults (`wmsUrl`, `infoFormat`, `featureInfoFields`, etc.) that
   cascade to layers via `getEffectiveWmsUrl` and the fallback chain in
   `themeWMS.ts`.
2. Import + append to the `configs` array in
   `src/map/layers/themeLayerConfigApi.ts` inside `getThemeLayerConfig()`.
3. Add the layer id(s) to a union in `src/map/layers/themeWMS.ts` and into
   `ThemeLayerName`.
4. Route requests through `wmscache` instead of hitting the origin from the
   browser. Add a `handle_path /wms/<host-slug>/*` block in `Caddyfile` that
   rewrites to the upstream's WMS path prefix, plus an `upstream` +
   `location` pair in `nginx/wms-cache.conf`, and use `/wms/<host-slug>/...`
   as `wmsUrl` in the config. This gives you the 25 GB LRU disk cache and
   same-origin browser requests for free (no CSP entry needed).
5. If the WMS's GetFeatureInfo doesn't offer JSON, set `infoFormat` on the
   category or layer to a format the parser can handle
   (`application/vnd.ogc.gml` works for MapServer via `parseXmlFeatureInfo`).

## Adding another background layer

1. Add id to the appropriate name union in
   `src/map/layers/backgroundLayers.ts`.
2. Create/extend a config in `src/map/layers/config/backgroundLayers/` and
   spread it into `allConfiguredBackgroundLayers` in `atoms.ts`. For a WMS
   layer, set `coverageExtent` from the service's GetCapabilities
   `<BoundingBox>` (see "Tile-loading constraints").
3. Add priority in `backgroundLayerOrder` in
   `src/map/backgroundLayer/utils.ts` (controls display order in the "Kart"
   panel).
4. Handle the thumbnail in `getBackgroundLayerImageName` in
   `src/map/atoms.ts` — either add a `public/backgroundlayerImages/<id>.png`
   asset or map to an existing image as a placeholder.
5. Add translations under `map.settings.layers.mapNames.backgroundMaps.<id>`
   in `src/locales/{nb,nn,en}/translation.json`.

## Conventions specific to this fork

- Server-only rebuilds. Do not `npm install` / `tsc` / `npm run build`
  locally; the user's host doesn't carry the build toolchain. Print the
  `docker compose ...` commands they should run.
- Keep unused code out. If a helper (retry function, config field) has no
  live caller after a change, delete it — don't leave it in "for later".
- Commits use short imperative subject lines. Body explains the *why* when
  the reasoning isn't obvious from the diff. The `Co-Authored-By` trailer is
  added by the commit workflow.

## Removed upstream machinery — don't re-add

Deleted deliberately; if one of these reappears, something regressed.

- **The service-message banner** (`src/messages/`, `src/api/messageApi.ts`) —
  fetched Markdown from `raw.githubusercontent.com/kartverket/nk3config/…`,
  i.e. Norgeskart's operational announcements in Tufteseid's chrome plus a
  GitHub ping on every page load. It was the only consumer of
  `react-markdown` and of `getEnvName()`.
- **Hostname-based environment detection** in `src/env.ts` — it matched
  Kartverket's own domains, so every Tufteseid deployment fell through to
  `console.error('Unknown domain')` and silently ran the DEV table. There is
  now one `DEFAULT_ENV` plus the `window.__NK_CONFIG__` override from the
  bind-mounted `config.js`. The `envName` and
  `layerProviderParameters.geoNorgeWMS` keys went with it.
- **Google Fonts** (Raleway + Work Sans) in `index.html` — nothing set
  `font-family`; kvib's theme supplies Mulish, self-hosted. `font-src 'self'`
  is enough.
- **Dead dependencies**: `maplibre-gl` and `@geoblocks/ol-maplibre-layer`
  (OpenLayers is the map engine and is the right one for WMS + EPSG:25833;
  MapLibre is vector-tile-first and weak on non-Mercator projections), and
  `fast-xml-parser` (all XML goes through native `DOMParser`).

The Caddyfile CSP is narrowed to what the browser actually contacts:
`cache.kartverket.no` (WMTS tiles *and* its GetCapabilities fetch),
`*.geonorge.no`, `*.norgeskart.no` and `hoydedata.no` (the ArcGIS identify
call in `searchApi.ts`). `style-src 'unsafe-inline'` has to stay while the UI
is on kvib/Chakra: emotion injects styles at runtime.

## Lint and dev tooling

**oxlint, not ESLint.** Config is `.oxlintrc.json`; there is no
`eslint.config.js`.

The project is on TypeScript 7 (the native Go port), which
typescript-eslint's peer range still excludes — that made `npm ci` fail with
ERESOLVE. oxlint parses TypeScript natively and has no `typescript` peer at
all. Every remaining `typescript` peer in the tree
(`prettier-plugin-organize-imports` `>=2.9`, i18next / react-i18next
`^5 || ^6 || ^7`) accepts 7 on its own. **Don't add an `overrides` block for
this** — if it seems necessary, something pulled a typescript-eslint
dependency back in.

Two things to know before editing `.oxlintrc.json`:

- **No plugins are enabled by default** — they must be listed in `plugins`.
  And rules only fire if their *category* is enabled. `react/hooks`
  (rules-of-hooks) is `suspicious` and `react/only-export-components` is
  `restriction`, neither of which is on, so both are listed explicitly under
  `rules`. Enabling only `correctness` would silently drop rules-of-hooks
  across ~400 hook call sites.
- `react/exhaustive-deps` is deliberately `warn`, matching what
  eslint-plugin-react-hooks' recommended preset did.

Dropped in the move to oxlint, on purpose: `eslint-plugin-compat`
(browserslist API checking — no oxlint equivalent; `browserslist` in
`package.json` still drives the build) and `eslint-plugin-prettier`
(formatting is `npm run format` / `format-check`, not a lint rule).

`npm run lint` is not enforced anywhere: absent from the Dockerfile, no git
hooks, no CI. The build is `npm ci && tsc -b && vite build`, so type errors
block a deploy and lint findings don't.

Note `prettier-plugin-organize-imports` drives the TypeScript *language
service*, the part of the API the native port trims hardest. If
`npm run format` starts failing under TS 7, that plugin is the first suspect.
