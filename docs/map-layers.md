# Map layers

What is drawn on the map: background grounds (`src/map/layers/config/backgroundLayers/`),
Kulturminner theme layers (`src/map/layers/config/themeLayers/`), and the recipes
for adding another.

Related: `docs/wms-proxy-and-tiles.md` (proxying, caching, tile grids, rate
limits, CSP), `docs/terrain-analysis.md` (float elevation, the client-side
visualizations), `docs/architecture.md` (modules, atoms, the two-ground
mechanism).

## Conventions

- All WMS requests are `VERSION=1.3.0`, same-origin through a `/wms/…` prefix.
- Nothing sets `SRS`/`CRS`. OpenLayers writes it from the view projection —
  `DEFAULT_PROJECTION = 'EPSG:25833'` (`src/map/atoms.ts`). `coverageExtent`
  declares its own CRS and is transformed to the view projection with 8 stops
  per edge (`toViewExtent`, `utils.ts`).
- A `/cache/…` prefix is not a WMS: those are `{z}/{x}/{y}` tiles out of
  MapProxy, configured in `mapproxy/mapproxy.yaml`. Caddy rewrites
  `/cache/<name>/{z}/{x}/{y}.(png|jpeg)` to
  `/mapproxy/tiles/<name>/tufteseid25833/…`.
- `/cvat/…` is our own tile store, served by the `cvat-tiles` sidecar. Nothing
  upstream, so no wmscache entry and no CSP host.

### Tile grid

`src/map/layers/wmsTileGrid.ts`. One grid per projection, built off the
projection extent.

| Constant | Value | Why |
| --- | --- | --- |
| `WMS_TILE_SIZE` | 512 | wms.geonorge.no rate-limits by source IP at ~120 GetMaps in a short window; over it the answer is HTTP 200 with a 238-byte ServiceException that OL marks ERROR and never retries. |
| `VIEW_TILE_SIZE` | 256 | The View's zoom ladder divides the extent by 256 whatever tile size is used. |
| `VIEW_MAX_ZOOM` | 20 | Deepest level any source is asked for. |
| `WMS_Z_DIRECTION` | 1 | Between two resolutions, ask for the coarser level. |
| `WMS_TILE_CACHE_SIZE` | 128 | ~10 screenfuls at 512 px. |

`maxResolution = max(extent width, height) / 256`; resolutions are indexed by
absolute z, so a source holding only deep levels still gets the whole array and
is fenced by `minZoom`.

MapProxy's `tufteseid25833` grid mirrors this level for level: `min_res 21664.0`,
`res_factor 2`, `tile_size [512, 512]`, `num_levels 21`, `origin: nw`.

## Background grounds

`GROUND_MODES` is `['lidar', 'kart', 'flyfoto']` (`src/grounds/`); `groundOf()`
derives the ground from the background layer name, never stores it. One ribbon
arm per ground: `src/lidarControls/`, `src/kartControls/`,
`src/flyfotoControls/`, in the band at `src/ribbon/`.

Cold load with no usable `?backgroundLayer` lands on `lidarHillshade`
(`getDefaultBackgroundLayer`, `config/backgroundLayers/atoms.ts`).

| Layer name | Type | URL / upstream | Grid | Zoom | Config |
| --- | --- | --- | --- | --- | --- |
| `lidarHillshade` (`skyggerelieff`) | XYZ | `/cache/lidar-dtm/{z}/{x}/{y}.png`, `/cache/lidar-dom/…`; `…-held` siblings while the `hoyde` breaker is open | EPSG:25833 | 0–16 | `elevation.ts` |
| `lidarHillshade` (any other style) | WMS | `/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833` (`NHM_DTM_TOPOBATHY_25833`) or `wms.hoyde-dom-nhm-25833` (`NHM_DOM_25833`) | view | max 16 | `elevation.ts`, `lidarProjects.ts` |
| `lidarProject` | WMS | `/wms/geonorge/wms.hoyde-dtm-prosjekt` / `wms.hoyde-dom-prosjekt`, `LAYERS=<project id>:<style>` | view | max 17 | `stack.ts`, `lidarProjects.ts` |
| `lidarCvat` | XYZ | `/cvat/<path>/{z}/{x}/{y}.webp` | EPSG:25833 | per acquisition | `cvatGround.ts` |
| `topo`, `topograatone`, `toporaster`, `sjokartraster` | WMTS | `cache.kartverket.no/v1/service` GetCapabilities, one document for all four | from capabilities | — | `kvCache.ts` |
| `amtskart` | XYZ | `/cache/amtskart/{z}/{x}/{y}.png` — MapProxy over `wms.historiskekart`, `LAYERS=amt1` | EPSG:25833 | 0–20 | `kartVariants.ts` |
| `topoOverlay` | XYZ | `/cache/topo-ref` or `/cache/topo-ref-contours`, `.png` | EPSG:25833 | 0–20 | `topoOverlay.ts` |
| `flyfoto` | XYZ | `/cache/flyfoto/{z}/{x}/{y}.jpeg` — MapProxy over `/wms/nib/ortofoto` | EPSG:25833 | 0–20 | `flyfotoBackground.ts` |
| `flyfotoProject` | ArcGISImage (`TileArcGISRest`) | `/arcgis/nib/ortofoto_prosjekter/ImageServer` | view | max 18 | `flyfotoBackground.ts`, `flyfoto.ts` |
| `empty` | Empty | — | — | — | `stack.ts` |

Name unions: `src/map/layers/backgroundLayers.ts`. Type discriminants and per-type
fields: `config/backgroundLayers/types.ts`.

`KART_VARIANTS` (`kartVariants.ts`) is the Kart arm's ring: the four WMTS
cartographies plus `amtskart`.

### Coverage extents

Set as the OL layer's `extent`, so tiles outside are culled rather than rendered
upstream. Without one, OL takes the grid from the projection extent and asks for
open ocean.

| Extent (EPSG:25833) | Used by | Source |
| --- | --- | --- |
| `[-100275, 6399725, 1150255, 8000275]` | `lidarHillshade`, the same numbers in `mapproxy.yaml` source coverages | the høydedata services' `<BoundingBox CRS="EPSG:25833">` |
| `[-127998, 6377920, 1145510, 7976800]` | `amtskart`, `topoOverlay` | `wms.topo` / `wms.historiskekart` declared bounds |
| `[-250025, 6299985, 1211155, 8985010]` | `flyfoto` | the ortofoto WMS declared bounds |
| per project `bboxLonLat` (EPSG:4326) | `lidarProject`, `flyfotoProject` | GetCapabilities / MapServer query |
| per acquisition `extent25833`, falling back to the catalogue bbox | `lidarCvat` | the manifest's tile indices |

### MapProxy caches

`mapproxy/mapproxy.yaml`. Six upstream layers whose parameters never change,
plus two read-only views.

| `/cache/<name>` | Upstream | `LAYERS` |
| --- | --- | --- |
| `lidar-dtm` | `wms.geonorge.no/skwms1/wms.hoyde-dtm-nhm-topobathy-25833` | `NHM_DTM_TOPOBATHY_25833:skyggerelieff` |
| `lidar-dom` | `wms.geonorge.no/skwms1/wms.hoyde-dom-nhm-25833` | `NHM_DOM_25833:skyggerelieff` |
| `lidar-dtm-held`, `lidar-dom-held` | none (`sources: []`) — the same MBTiles files, so a miss is transparent rather than an upstream render | — |
| `topo-ref` | `wms.geonorge.no/skwms1/wms.topo` | `kd_veger,kd_jernbane,kd_stedsnavn,fkb_samferdsel,fkb_presentasjonsdata` |
| `topo-ref-contours` | same | the five above plus `kd_hoydekurver,fkb_hoydekurver` |
| `amtskart` | `wms.geonorge.no/skwms1/wms.historiskekart` | `amt1` |
| `flyfoto` | `http://nib-proxy:8080/ortofoto` | `ortofoto` |

No `on_error` anywhere: a shed response must reach the browser as a 500 so
`src/upstream/` trips, rather than being cached as a blank tile.

### Constraints that bite

**LiDAR styles.** Each style is its own named WMS layer, `<prefix>:<style>`.
DOM publishes one usable style, `skyggerelieff` (`DOM_STYLES`); asking a DOM
layer or the national mosaic for a style it does not publish fails silently —
HTTP 200, `Content-Type: image/png`, a ~100-byte JSON body, a blank map. Hence
`stylesForModel`, `effectiveLidarStyle` and `resolveLidarStyle`. `None` and
`dynamisk_farget_hoyde` are excluded: near-uniform, and ramped per tile so
neighbouring tiles disagree. `?lidarModel=dom` persists the model; absent means
DTM.

**`cvat` is a style, not a dataset.** `CVAT_STYLE = 'cvat'` sits at the head of
`TIER_A_STYLES` and is offered by `stylesForFlight()` wherever the store holds
the flight. `lidarFlightGround(style, model)` is the only namer of
`lidarProject` vs `lidarCvat`; `wmsLidarStyle()` guards the GetMap so a stray
`cvat` can never reach a service.

**The LiDAR catalogue** is an ~8 MB GetCapabilities off
`wms.hoyde-dtm-prosjekt`. `fetchLidarProjects()` caches it in localStorage under
`lidarProjects.v4` for a week and falls back past the TTL to whatever copy is
still there. DTM and DOM publish identical project catalogues, so one fetch
serves both. Project names starting `Bilde` are photogrammetry DTMs that
advertise lidar styles and draw blank tiles; they are filtered out.

**The cVAT store is read at runtime.** `fetchCvatStore()` fetches
`/cvat/manifest.json` once per page load; `resolveCvatAcquisitions()` joins it
to the catalogue. A manifest acquisition name is byte-identical to
`LidarProject.id`, which is what the whole wiring rests on — an acquisition whose
name is not verbatim in the per-project WMS GetCapabilities cannot be wired in.
Where the catalogue has no row, `placeFromStore()` synthesizes one from the
manifest envelope (year and density parsed out of the name, no WMS styles). The
store's envelope is inclusive tile indices at `ENVELOPE_FLOOR_Z = 12`
(`cvat-tiles/server.mjs`), or the coarsest level held.

`lidarCvat` sets `sparse: true`: unwritten tiles inside the extent 404, OL leaves
them transparent, and that transparency is the coverage mask — so the retry in
`tileGuard.ts` is off. `preload: 2`, since a miss is a `SELECT` against a
bind-mounted database. `getXYZLayer` sets `maxResolution` one step coarser than
the store's coarsest level, or OL clamps there and asks for four screenfuls to
upscale.

**Provenance constants** for the cVAT plate live in `cvatGround.ts` —
`CVAT_RENDERER`, `CVAT_TEMPLATE`, `CVAT_STACK`, `CVAT_AZIMUTH`,
`CVAT_SUN_ALTITUDE`, `CVAT_RADIUS_PX`, `CVAT_GENERAL_OPACITY`. Transcribed from
`vat-cache/cvat.py`, not fetched from the manifest. Rebuilding the store under
changed parameters means editing that block too.
`CVAT_LEGACY_ACQUISITION_ID = 'Vestfold og Telemark 5pkt 2021'` is what a record
written before the plate existed was taken over.

**Amtskart** is transparent and in `NEEDS_TOPO_BASE`: the series stopped around
1917 and never covered Nordland.

**Hybrid contours** ride the overlay's own GetMap — two MapProxy caches, not a
second layer. The published `hoydekurver_1m` / `_5m` are raw feature layers and
render nothing at any scale.

**NiB publishes no per-project WMS** (`/wms/ortofoto_prosjekter` 403s). One
acquisition comes off the ImageServer with
`mosaicRule={"mosaicMethod":"esriMosaicNone","where":"prosjektnavn='…'"}`; the
default method blends neighbouring projects back in, and the symptom is a picked
year that looks almost right. `FORMAT: jpgpng` (JPEG inside coverage,
transparent PNG outside; plain `jpg` paints the gaps black) arrives as
`octet-stream`, which nib-proxy re-labels by magic bytes. `hidpi: false`, or
`SIZE`/`DPI` scale by pixel ratio and wmscache keys the same ground twice.

**Ortofoto acquisitions** are enumerated on
`/arcgis/nib/prosjekter/MapServer/4/query` (layer 4, "Prosjektomriss
prosessert"), with `ortofototype = 6` ("Satellittbilde", nationwide 10 m
Sentinel-2 mosaics) dropped. `prosjektnavn` is the same column there and in the
ImageServer catalogue. The ImageServer's own `/query` is unusable:
`returnDistinctValues=true` silently returns zero features, undistinct one row
per raster tile.

**`interpolate: false`** on the LiDAR grounds and `lidarCvat`: above a source's
deepest level the bilinear kernel clamps at each tile's own edge and draws a seam
at every tile boundary.

## The background stack

`resolveStack` / `buildStack` (`config/backgroundLayers/stack.ts`) build a stack,
bottom-first:

1. A topo base for everything in `NEEDS_TOPO_BASE` — `lidarProject`,
   `lidarHillshade`, `lidarCvat`, `flyfotoProject`, `amtskart`. Not `flyfoto`:
   opaque JPEG.
2. A seamless fallback at `FALLBACK_OPACITY` (0.6) under a per-project dataset:
   the national mosaic under `lidarProject` and `lidarCvat`, the ortofoto mosaic
   under `flyfotoProject`. Always `skyggerelieff`, and always DTM under
   `lidarCvat`, which has no model toggle to undo a held DOM.
3. The featured dataset.
4. The topo overlay in hybrid, at `HYBRID_OVERLAY_Z` (0.75) — the only background
   layer off z-index 0. `LIDAR_LAYERS` (`lidarProject`, `lidarHillshade`,
   `lidarCvat`) is what the hybrid overlay, contours and model apply to.

`swapBackgroundLayers(under, over)` (`utils.ts`) installs the result: 1–2 go
under the outgoing layers, 3–4 over them.

- `resolveStack` is pure, `buildStack` awaits. The two-ground views
  (`src/map/compare/`) resolve a second stack by the same rules; `buildStack`
  takes a host map, because an OL layer belongs to one map at a time.
- The URL follows the resolved stack, not the atoms: `?hybrid=true`,
  `?contours=true` and `?lidarModel=dom` are written only when they ended up in
  it.
- Outgoing layers are dimmed to `OUTGOING_OPACITY` (0.35) and retired on the next
  `rendercomplete`, with `SWAP_TIMEOUT_MS` (15 s) as a backstop.
- `buildOrReuseBackgroundLayer` reuses a layer whose `layerSignature` (url +
  params + projection, namespaced `bg`/`cmp`) matches. A reused layer carries an
  earlier fade and z-index, so callers set both explicitly on every layer.
  `installCompareLayers` overrides the stack's z-index with `COMPARE_Z`.
- `VALID_STARTUP_LAYERS` (`atoms.ts`) is what `?backgroundLayer=` may name.
  Excludes `lidarProject` and `flyfotoProject`: their acquisition atom starts
  null and only the user can fill it.

### The layer pool

`src/map/layers/layerPool.ts`. A tile cache lives on the layer's renderer, so a
layer taken off a map loses everything it had loaded.

- `MAX_POOLED` 8 (one background stack plus one B stack), `POOL_TTL_MS` 300000
  (5 minutes).
- Every removal goes through `retireLayer(map, layer)`, not `map.removeLayer` —
  only what actually came off a map is kept.
- Key is the `POOL_KEY` property: `layerSignature` namespaced `bg`/`cmp` for a
  background, `themeLayerPoolKey(id, projection)` for a theme layer. A layer
  without one is dropped.
- The pool lookup may cross hosts where the in-collection lookup may not, since
  nothing in the pool is on a map.
- A pooled layer carries whatever state it left with (fade, visibility, curtain
  clip, extent). Installers set all of those on every incoming layer.

### Map z-order

| z | What | Where |
| --- | --- | --- |
| 0 | backgrounds, ordered by collection position | `stack.ts` (`GROUND_Z`) |
| 0.5 | the cVAT store's coverage hint | `src/map/cvatHintLayer.ts` |
| 0.75 | hybrid's topo overlay | `stack.ts` (`HYBRID_OVERLAY_Z`) |
| 1 | terrain-analysis render | `src/terrain/terrainLayer.ts` |
| 1.25 | the kept render being read on a spot | `src/evidence/evidenceOverlay.ts` |
| 1.5 | the B half of a two-ground view | `src/map/compare/compareLayers.ts` (`COMPARE_Z`) |
| 2 | an open spot's drawing | `src/sketch/overlay.ts` |
| 3 | LiDAR footprint outlines | `src/map/lidarFootprintsLayer.ts` |
| 4 | a rectangle in hand — the terrain window or a spot's footprint | `src/map/rectAdjust.ts` |
| 4 | terrain-analysis window frame, standing | `src/terrain/windowLayer.ts` |
| 5 | a spot's footprint frame, standing | `src/spots/footprintLayer.ts` (`PIN_Z_INDEX - 1`) |
| 6 | a spot's pin and label | `src/spots/pinStyle.ts` (`PIN_Z_INDEX`) |
| 10 | Kulturminner theme layers | set by the caller in `src/map/layers/atoms.ts`, not by `themeWMS.ts` |

7–9 are free. A new overlay should be written down here.

Only one rectangle is ever in hand, so the two `rectAdjust` mounts share z 4
without colliding; they are told apart by the layer id they are given
(`terrainAdjustLayer`, `spotFootprintAdjustLayer`). Each standing frame goes down
while its own rectangle is being dragged. The footprint sits just under the pin
so the pin it belongs to stays legible over it.

The hint layer is why 0.75 exists: roads and place names have to clear the hint
patches as well as the ground.

### The coverage hint

`src/map/cvatHintLayer.ts` puts one layer per cached acquisition on the map at
z-index 0.5, over whichever ground is up. Ids are `cvatHint.<path>`, outside the
`bg.` namespace that `swapBackgroundLayers` sweeps. The band is the store's
coarsest level down to `AUTO_ENGAGE_M_PER_PX` (1 m/px, `lidarAuto.ts`), where
Automatisk starts handing the reader a flight. Off in the two-ground views, and
on the LiDAR grounds only. Layers are added worst-ranked first, so the
highest-ranked overlapping flight draws on top.

## Kulturminner theme layers

Config `src/map/layers/config/themeLayers/culturalHeritage.ts`, registered as
`themeLayerConfig` in `src/map/layers/themeLayerConfigApi.ts` and in
`ThemeLayerName` (`src/map/layers/themeWMS.ts`). All five go
`/wms/ra/<name>` → wmscache → `kart.ra.no/wms/<name>`.

| Layer id | `wmsUrl` | `layers` | What it is |
| --- | --- | --- | --- |
| `heritageSites` | `/wms/ra/kulturminner2` | `Kulturminner` | lokaliteter, enkeltminner, sikringssoner |
| `culturalEnvironments` | `/wms/ra/kulturmiljoer` | `Kulturmiljoer` | kulturmiljøer |
| `sefrakBuildings` | `/wms/ra/sefrak` | `SEFRAK` | SEFRAK-registered buildings |
| `protectedBuildings` | `/wms/ra/freda_bygninger` | `Freda_bygninger_WMS` | fredede bygninger |
| `userReportedHeritage` | `/wms/ra/brukerminner` | `Brukerminner_WMS` | user-reported minner |

Category defaults on `culturalHeritage`, cascading to all five:

- `infoFormat: 'application/vnd.ogc.gml'` — so `parseXmlFeatureInfo` (MapServer
  `msGMLOutput`) produces structured fields. Left unset, the WMS returns HTML
  and the card shows a placeholder.
- `extraWmsParams: { map_resolution: 192 }` — MapServer DPI hint scaling symbols
  and line widths; the default is 96.
- `minZoom: 8` — ~300k heritage records nationally is an unreadable wall of pins
  below z8.

`themeLayerEffect` (`src/map/layers/atoms.ts`) puts them on the map, and on both
maps in the split view: `syncThemeLayers` is called once per map and each gets
its own instances off the same config. Only the main map's result writes
`?themeLayers=`.

These five are the only layers a pointer can question. `heritageQuery.ts` asks
them by id, not by the `theme.` prefix; `src/heritageInfo/` puts the question and
draws the tip and the card. `isRendering` means a register hidden behind the
blind (`heritageHiddenAtom`) is never asked about.

### `kulturminner2` sublayers

`src/map/layers/heritage.ts`. Two independent settings, both URL-persisted
(`?heritageDetails=`, `?heritageRender=`; opacity is `?heritageOpacity=`,
floor `MIN_HERITAGE_OPACITY` 0.2).

`HERITAGE_DETAILS`: `lokaliteter`, `enkeltminner`, `sikringssoner`.
`HERITAGE_RENDERS`: `omriss`, `flate`, then the five vern subsets `fredede`,
`verneverdige`, `listefoerte`, `utenVern`, `uavklart`.

| Sublayer | `omriss` | `flate` | vern subsets |
| --- | --- | --- | --- |
| `Lokaliteter` | `''` | `heldekkende` | `fredede`, `verneverdige`, `listefoerte`, `uten_vern`, `uavklart` |
| `Lokalitetsikoner` | `''` | `''` | as above, but `Uavklart` capitalized |
| `Enkeltminner` | `grenser` | `inspire_common:DEFAULT` | as `Lokaliteter` |
| `Enkeltminneikoner` | `''` | `''` | as `Lokaliteter` |
| `Sikringssoner` | `inspire_common:DEFAULT` | `heldekkende` | none — no `vernetype` column, so it drops out under any subset |

Contracts:

- Style names are not derivable from render names. `Enkeltminner`'s default
  style is the fill and `grenser` its outline, the inverse of `Lokaliteter`;
  `Lokalitetsikoner` spells `Uavklart` capitalized. An unpublished style is a
  ServiceException (a wall of broken tiles); a published but empty one is a
  valid transparent PNG.
- Each register expands to a polygon sublayer and its icon twin. Polygon
  sublayers stop at 1:25 000 (`MaxScaleDenominator`), icons carry to 1:450 000.
- `LAYERS` order is cartography — the WMS paints front to back, last name wins
  the pixel. `PAINT_ORDER` is bottom-to-top: `Sikringssoner`, `Lokaliteter`,
  `Enkeltminner`, `Lokalitetsikoner`, `Enkeltminneikoner`. Grouping by register
  instead puts each register's icon under the next register's polygon; RA's own
  root layer `Kulturminner` draws the clean version and is the check.
- `LAYERS` and `STYLES` are positional and must stay the same length.
- `heritageSitesParams` returns null when the settings select nothing (every
  register off, or only Sikringssoner under a vern subset). Hide the layer rather
  than send a request that can only come back empty.
- Rendering is one axis: `STYLES` takes a single value per `LAYERS` entry and RA
  publishes no filled variant of any subset, so "filled *and* fredede only" is
  not a request that exists.

Whether a feature's `linkkulturminnesok` URL resolves is asked separately
(`src/map/featureInfo/kulturminnesok.ts`, `docs/wms-proxy-and-tiles.md`).

## Recipe: add a theme layer

1. A config in `src/map/layers/config/themeLayers/` exporting a
   `ThemeLayerConfig` with `categories[]` and `layers[]`. Category defaults
   (`wmsUrl`, `infoFormat`, `featureInfoFields`, `extraWmsParams`, `minZoom`)
   cascade through `getEffectiveWmsUrl` and the fallback chain in `themeWMS.ts`.
2. Merge it into `themeLayerConfig` in `src/map/layers/themeLayerConfigApi.ts`.
3. Add the layer id(s) to `ThemeLayerName` in `src/map/layers/themeWMS.ts`. They
   appear in the `Kulturminner` popover automatically, and as a source in
   `src/heritageControls/`, which lists whatever `themeLayerConfig` holds.
4. Route the requests through wmscache and use the same-origin
   `/wms/<host-slug>/…` prefix as `wmsUrl` — `docs/wms-proxy-and-tiles.md`.
5. If GetFeatureInfo offers no JSON, set `infoFormat` to something the parser
   handles (`application/vnd.ogc.gml` for MapServer).

## Recipe: add a background layer

1. Add the id to `WMTSLayerName`, `WMSLayerName`, `ArcGISImageLayerName` or
   `XYZLayerName` (`src/map/layers/backgroundLayers.ts`). The matching
   discriminant is the `type` field on `BackgroundLayer`
   (`config/backgroundLayers/types.ts`). A new source type also needs a builder
   in `utils.ts` and an arm in `layerSignature` — without the signature every
   dataset cycle rebuilds the layer, the pool never holds it, and a ground
   already drawn flashes. A new builder calls `guardTileSource(source, url)`
   before handing the source to the layer, with `{ retry: false }` where a 404 is
   the source's own coverage mask (`docs/wms-proxy-and-tiles.md`).
2. Create or extend a config in `src/map/layers/config/backgroundLayers/` and
   spread it into `allConfiguredBackgroundLayers` in `stack.ts`.
   `coverageExtent` is mandatory for anything that can reach an upstream, XYZ
   over `/cache/` included; `XYZBackgroundLayer` also requires `projection`,
   `minZoom`, `maxZoom`, `preload` (0 or 2) and `sparse`. If the source is a
   fixed layer+style, it should be a MapProxy cache rather than a `TileWMS` —
   that recipe is in `docs/wms-proxy-and-tiles.md`.
3. A layer whose concrete source is a runtime choice gets a branch in
   `pickLayerConfig` rather than a static entry, and stays out of
   `VALID_STARTUP_LAYERS`.
4. Add it to `NEEDS_TOPO_BASE` if it answers transparent outside coverage, and to
   `LIDAR_LAYERS` if the hybrid overlay, contours and model toggle apply.
5. Give it a control. A new member of an existing ground is a row in that arm's
   menu; a ground of its own is a fourth arm plus an entry in `GROUND_MODES` and
   `groundOf` (`src/grounds/`). Until it has either, it is reachable by setting
   `backgroundLayerHalves.a`, and by `?backgroundLayer=` if it is safe to
   cold-load onto.
6. Translations in `src/locales/nb/translation.json`.
