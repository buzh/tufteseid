# Map content — what is drawn, and where it comes from

The background grounds and the services behind them, and the Kulturminner theme
layers from Riksantikvaren. Read before touching `src/map/layers/`. Proxying,
caching, tile grids and the Kartverket rate limit are
`docs/wms-proxy-and-tiles.md`; the float-elevation path behind terrain analysis
is `docs/terrain-analysis.md`.

The ribbon drives all three grounds below: a ground switch (`src/grounds/`) and
one arm per ground — `src/lidarControls/`, `src/kartControls/`,
`src/flyfotoControls/` — in the band at `src/ribbon/`. What it does not drive
is the Hybrid overlay and its contours, which stay a `set()` away;
`docs/state-of-the-branch.md` has the rest of what the rebuild has reached.

All WMS requests are `VERSION=1.3.0`, same-origin through a `/wms/…` prefix.
Nothing sets `SRS`/`CRS` by hand — OpenLayers writes it from the view
projection, `EPSG:25833` by default (`DEFAULT_PROJECTION`, `src/map/atoms.ts`);
`coverageExtent` declares its own CRS and is transformed to that projection.

A `/cache/…` prefix means the browser is not asking a WMS at all: those layers
are `{z}/{x}/{y}` tiles out of MapProxy, which asks the WMS on our behalf and
keeps the answer (`docs/wms-proxy-and-tiles.md`). The upstream and its `LAYERS`
are named in the table below all the same, because that is still what the pixels
are; where they are written down is `mapproxy/mapproxy.yaml`.

## The grounds

The grounds the old interface grouped as `lidar`, `terreng`, `kart`, `hybrid`
and `flyfoto`. `terreng` is not a background layer at all but a client-rendered
overlay over whatever background is set (`docs/terrain-analysis.md`); the rest
are entries in the stack below. A cold load with no `?backgroundLayer`
arrives on `lidarHillshade`, the national relief mosaic
(`getDefaultBackgroundLayer`, `config/backgroundLayers/atoms.ts`): reading
relief is what the app is for, and Automatisk takes it to a per-project dataset
from there.

| Ground | Layer name(s) | Service / prefix | Dataset ring (W/S) |
|---|---|---|---|
| LiDAR | `lidarHillshade` (national mosaic) | `/cache/lidar-dtm`, DOM `/cache/lidar-dom`, to z16 — MapProxy over `wms.hoyde-dtm-nhm-topobathy-25833:skyggerelieff` and `wms.hoyde-dom-nhm-25833:skyggerelieff`; `…-held` siblings while the `hoyde` breaker is open. Any other style falls back to `/wms/geonorge/wms.hoyde-…` direct | Automatisk / national / per-project |
| LiDAR | `lidarProject` (0.25 m per acquisition, rendered by the WMS) | `/wms/geonorge/wms.hoyde-dtm-prosjekt`, DOM: `wms.hoyde-dom-prosjekt`; `LAYERS=<project id>:<style>` | same ring |
| LiDAR | `lidarCvat` (the same acquisition, rendered by us: **Arkeologisk relieff**) | `/cvat/<acquisition>/{z}/{x}/{y}.webp` — our own tile store, read out of MBTiles by the `cvat-tiles` sidecar, nothing upstream | not on it — it is the `cvat` entry of the style ring (A/D) |
| Analyse | — | `/arcgis/hoydedata/*`, see `docs/terrain-analysis.md` | the visualization list |
| Kart | `topo`, `topograatone`, `toporaster`, `sjokartraster` (WMTS) | `cache.kartverket.no/v1/service` GetCapabilities, one document for all four | the five `KART_VARIANTS` |
| Kart → Amtskart | `amtskart` (1:200 000) | `/cache/amtskart` — MapProxy over `wms.historiskekart`, `LAYERS=amt1`, transparent | same ring |
| Hybrid | `topoOverlay` (modifier, not a ground of its own) | `/cache/topo-ref`, or `/cache/topo-ref-contours` with contours on — MapProxy over `wms.topo`, transparent | the LiDAR ring underneath |
| Flyfoto | `flyfoto` (seamless mosaic, JPEG) | `/cache/flyfoto` — MapProxy over `/wms/nib/ortofoto`'s `ortofoto`, through the same token sidecar | ortofoto acquisitions |
| Flyfoto | `flyfotoProject` (one acquisition; `TileArcGISRest`, not WMS) | `/arcgis/nib/ortofoto_prosjekter/ImageServer` | same ring |

Configs live in `src/map/layers/config/backgroundLayers/`: `kvCache.ts` (WMTS
cartographies), `kartVariants.ts` (the ring, `AMTSKART_CONFIG`),
`elevation.ts` + `lidarProjects.ts`, `cvatGround.ts`, `topoOverlay.ts`,
`flyfotoBackground.ts`. Name unions are in `src/map/layers/backgroundLayers.ts`.

### Service facts

- Amtskart: `amt1` is the seamless mosaic, `georefererte` wants the id of one
  scanned sheet. The series ran 1826 to around 1917 and never covered Nordland,
  hence `TRANSPARENT` and `NEEDS_TOPO_BASE`. GetMap probes want the EPSG:25833
  bbox in E,N order, against the layer metadata's own sample URL.
- The DTM and DOM per-project catalogues are identical (the same 1936 project
  names), so `fetchLidarProjects()` is one fetch, model-independent.
- DOM publishes one usable style, `skyggerelieff` (`DOM_STYLES`, clamped by
  `stylesForModel` / `effectiveLidarStyle`). Asking it for a DTM-only style
  (`helning_prosent`) fails silently: HTTP 200, `Content-Type: image/png`, a
  ~100-byte JSON body, a blank map. `?lidarModel=dom` persists the choice,
  absent means DTM, and the LiDAR extract is DTM-only.
- **`lidarCvat` is a render of a flight, not a dataset beside one.** The
  dataset is the acquisition; whether its relief is computed by Kartverket's
  WMS or by us is the render chosen on it, so `cvat` is a member of the style
  vocabulary (`CVAT_STYLE`, at the head of `TIER_A_STYLES`) offered by
  `stylesForFlight()` wherever the store holds that flight, and the two layer
  names are the two grounds one flight can be drawn under.
  `lidarFlightGround(style, model)` is the only namer, called by
  `useLidarControls` and by `compare/atoms.ts`; `wmsLidarStyle()` guards the
  GetMap so a stray `cvat` can never reach the service. The name is kept as a
  `BackgroundLayerName` rather than folded into `lidarProject` because the URL,
  a screenshot's `meta.ground` and the figure plate all read it to say which
  render made the picture.
- `lidarCvat` has nothing upstream. `vat-cache/makevat.py` runs RVT over an
  acquisition's DTM and writes the combined VAT — hillshade, slope, positive
  openness, sky-view in one picture — as 512 px RGBA WebP on the app's own tile
  grid, down to z12 (5.289 m/px), into one MBTiles database whose own `metadata`
  table records the acquisition's name, the levels written for it, the presets,
  the blend order, the per-level radii and the run's digest. How deep
  the ladder goes is the acquisition's own: z16 (0.331 m/px) where hoydedata.no
  publishes a 0.25 m DTM, z15 (0.661 m/px) where it publishes 0.5 m, because
  below the DEM's cell the picture is of the interpolation. What serves it is
  the `cvat-tiles` sidecar, turning the URL into one indexed `SELECT` against
  the acquisition's MBTiles database in the bind-mounted store; no upstream
  means no wmscache entry, and same-origin means no CSP host. Radii are RVT
  pixels at every level, so an acquisition's levels are related pictures of the
  same terrain rather than one picture at several sizes: the reach of the
  visualization grows as you zoom out, and the tooltip says so.
- **Acquisitions may overlap, and two rows is the point.** Each owns a database
  in the store, whose filename the manifest reports as that acquisition's `path`
  and the app puts in the tile template — so a 5 pkt flight from 2021 and a
  10 pkt one from 2025 over the same landscape are two readings of it, both
  offered, neither overwriting the other.
  They are two rows because they are two *flights*, ranked against each other by
  coverage, year and density like any other pair; the store having rendered both
  adds no row and breaks no tie. Ladder depth is not a tiebreak, because it is
  not independent of the ranking — z16 exists only where hoydedata publishes a
  0.25 m DTM, which is where the denser, newer flight already wins.
- **The store is read at runtime, not compiled in.** `fetchCvatStore()` reads
  `/cvat/manifest.json` once per page load and `resolveCvatAcquisitions()`
  places its `acquisitions` block, so a database copied onto the server is in
  the app on the next reload with no deploy and no code change. That manifest is
  not a file: the sidecar surveys the store, reads each database's `metadata`
  for the name and the levels it claims, and takes the envelope off the tiles
  table — inclusive tile indices at the coarsest level held, flipped from
  MBTiles' south-origin rows to the app's. So there is no inventory beside the
  tiles that can disagree with them, and copying a file in is the whole
  delivery. An install without a store answers an empty `acquisitions` block,
  which is no cached rows anywhere rather than a dataset that is offered and
  draws nothing. Levels are per acquisition, so a half-built one draws at the
  levels it has and nowhere else.
- **The store stands on its own.** The LiDAR catalogue is asked for and not
  depended on. Where it has a row for the acquisition that row wins, because it
  carries the flight's WMS styles and the manifest cannot know them. Where it
  has none — a flight Kartverket has dropped, or an outage — `placeFromStore()`
  makes a row out of the manifest: the acquisition name is the id, the year and
  point density come out of that name by the catalogue parser's own two
  readers, and the envelope out of the tile indices. Such a flight offers the
  cached render and no other, which is honest and is also all that can be drawn
  while the service publishing the others is down. That matters because the
  catalogue is an 8 MB GetCapabilities off the same høydedata backend as the
  national mosaic: the hour our own tiles are the only relief left is exactly
  the hour that document does not answer. `fetchLidarProjects()` also falls back
  past its week-long TTL to whatever copy localStorage still holds.
- It is the one ground whose relief nobody upstream computed, so it is the one
  that has to say where it came from. The render menu prints the acquisition,
  the renderer, the template and the radii at the head of its dropdown, where
  the reader is choosing between pictures rather than hovering for a caption; a
  kartutsnitt taken over it records which
  acquisition was showing (`meta.cvatAcquisition`) and carries it on its
  provenance plate, with the renderer, the template, the blend
  stack, the combine and the pixel radii, and credits Kartverket under
  `høydedata` rather than `skyggerelieff` — the height values are theirs, the
  picture is not. The constants the plate prints live beside the layer config in
  `cvatGround.ts` (`CVAT_RENDERER`, `CVAT_TEMPLATE`, `CVAT_STACK`,
  `CVAT_AZIMUTH`, `CVAT_SUN_ALTITUDE`, `CVAT_RADIUS_PX`,
  `CVAT_GENERAL_OPACITY`), transcribed from the recipe the databases carry
  rather than fetched from it: a downloaded figure travels off this host.
  Rebuilding the store under changed parameters — a new digest stamped into the
  files — means editing that block too.
- Its coverage needs no polygon. The layer's `extent` is the store's own
  envelope out of the manifest — the catalogue's bbox only where the manifest
  carries none, an older sidecar — and culls everything outside; inside it the ~94 %
  that were never written answer 404, OpenLayers marks those tiles errored and
  leaves them transparent, and the faded national mosaic underneath shows
  through. `maxResolution` hides the layer one step coarser than the
  acquisition's coarsest level rather than letting OL clamp and ask for four
  screenfuls to upscale. Where two acquisitions' envelopes overlap the layer
  still draws only the showing one's tiles — each has its own namespace, so
  there is nothing of the neighbour's to answer with, and the envelope's own
  ~94 % of unwritten ground stays transparent.
- The manifest's acquisition names are byte-identical to the `LidarProject.id`
  the per-project WMS publishes, which is what the whole wiring rests on:
  `CvatAcquisition` carries the catalogue row itself, so `cvatFor()` joins a
  chosen flight to its cached render by id alone, the envelope comes from the
  same row, and `Behold` stitches that project's own WMS — DTM,
  `skyggerelieff` — with no name mapping and no second coverage source. An
  acquisition whose name does not appear verbatim in the per-project WMS
  `GetCapabilities` cannot be wired in at all; `vat-cache/README.md` says so at
  the point where the next one is chosen.
- Which acquisition is drawing is `activeCvatAcquisitionHalves`
  (`cvatGround.ts`), halved like the LiDAR project and seeded into the B half
  with it. It is written only in lockstep with
  `activeLidarProjectHalves`, by `selectProject` — the flight is the choice and
  this follows it, so the two can never name different acquisitions. It starts
  null, so a cold load into `?backgroundLayer=lidarCvat` draws nothing for a
  tick — the URL names the render, not the flight it was of. Nothing extra
  fills it in: Automatisk is on at every cold load, so the footprint ranking
  names the flight as soon as it lands and `preferredLidarRender()` puts the
  render back on the cache where the store holds it. Where it does not, the
  link resolves to that flight's WMS.
- Hybrid's `LAYERS` is always the five reference groups
  `kd_veger,kd_jernbane,kd_stedsnavn,fkb_samferdsel,fkb_presentasjonsdata` —
  the generalized `kd_*` groups stop around 1:25 000 and the `fkb_*` ones take
  over — with `kd_hoydekurver,fkb_hoydekurver` appended to the same value for
  contours rather than stacked as a second layer. The published `hoydekurver_1m`
  / `_5m` are raw feature layers and render nothing at any scale. Both lists
  now live in `mapproxy/mapproxy.yaml` as two sources, and the contour toggle
  picks between two caches; `topoOverlay.ts` names the cache and nothing else.
- NiB publishes no per-project WMS: `/wms/ortofoto` serves only the merged
  `ortofoto` layer and `/wms/ortofoto_prosjekter` 403s. One acquisition comes
  off the ImageServer's mosaic catalogue with
  `mosaicRule={"mosaicMethod":"esriMosaicNone","where":"prosjektnavn='…'"}`;
  the default method blends neighbouring projects back in, and the symptom is a
  picked year that looks almost right.
- Acquisitions are enumerated on `/arcgis/nib/prosjekter/MapServer/4/query`
  (layer 4, "Prosjektomriss prosessert"), filtered server-side against real
  footprint polygons, `ortofototype = 6` ("Satellittbilde", nationwide 10 m
  Sentinel-2 mosaics) dropped. `prosjektnavn` is the same column there and in
  the ImageServer catalogue, so index and renderer need no name matching. The
  ImageServer's own `/query` is unusable: `returnDistinctValues=true` silently
  returns zero features, undistinct one row per raster tile (~1000 rows / 24 MB
  over Oslo, against ~121 projects in ~25 KB from the MapServer).
- `wms.georef_nib` is a *planning* layer, not a coverage register:
  GetFeatureInfo returns `prosjektfase` P/U, `r_pstart` in the future and
  `prosjektna` / `nib_navn` empty. There is no NiB WFS on GeoNorge.
- Old NiB WMS endpoints die September 2026; this uses
  `services.norgeibilder.no/wms/*`. The imagery is free for private,
  non-commercial use, publishing and commercial use being the user's
  responsibility, so anything that grabs pixels rather than browsing them has
  to say so at the point of the grab.

## The background stack

A ground is never one layer. `resolveStack` / `buildStack`
(`config/backgroundLayers/stack.ts`) build one, bottom-first:

1. a topo base for everything in `NEEDS_TOPO_BASE` (`lidarProject`,
   `lidarHillshade`, `lidarCvat`, `flyfotoProject`, `amtskart` — all leave the
   ground outside coverage transparent);
2. a seamless fallback at `FALLBACK_OPACITY` when a per-project dataset is
   active — the national mosaic under `lidarProject` and under `lidarCvat`, the
   best-available ortofoto mosaic under `flyfotoProject`. The LiDAR fallback is
   always `skyggerelieff`, and under the cached ground always DTM: that ground
   has no model toggle, so a held DOM would fill its holes with a surface
   mosaic nobody could turn off;
3. the active dataset;
4. the topo overlay, in hybrid.

`swapBackgroundLayers(under, over)` (`config/backgroundLayers/utils.ts`)
installs the result without a gap: 1–2 go *under* the outgoing layers, 3–4
*over* them. Rules:

- `resolveStack` is pure and `buildStack` awaits, so the two-ground views
  (`src/map/compare/`) resolve a second stack by the same rules. `buildStack`
  takes the host map, because in the split view that second stack is built into
  the right pane's own map and an OL layer belongs to one map at a time.
- The URL follows the *resolved* stack, not the atoms: `?hybrid=true` and
  `?contours=true` are written only when the overlay ended up in it.
- Outgoing layers are dimmed to `OUTGOING_OPACITY` and retired on the next
  `rendercomplete` (`SWAP_TIMEOUT_MS`, 15 s, as a backstop); tearing down first
  makes every W/S step flash topo.
- `buildOrReuseBackgroundLayer` reuses a layer whose url + params + projection
  match, so cycling rebuilds only what changed — and a reused layer may carry
  an earlier fade, so callers set opacity explicitly on every layer they pass.

### The layer pool

`src/map/layers/layerPool.ts`. A tile cache lives on the layer's renderer, so a
layer taken off a map loses everything it had loaded, and the next look at the
same ground pays a full screenful of GetMap at a rate limit the whole
deployment shares. The pool keeps retired layers for `POOL_TTL_MS` (5 minutes),
up to `MAX_POOLED` (8, one background stack and one B stack), so going to a
second ground and back, ticking a Kulturminner register off and on, or moving
between the curtain and the split costs nothing.

- Every removal goes through `retireLayer(map, layer)` rather than
  `map.removeLayer`, and only what actually came off a map is kept.
- The key is `POOL_KEY`, the same value the in-collection lookups match on: for
  a background that is `layerSignature` namespaced by `bg`/`cmp`, for a theme
  layer `themeLayerPoolKey(id, projection)`. A layer without one is dropped.
- The pool lookup may cross hosts where the in-collection one may not, because
  nothing in the pool is on a map. That is what lets the split pane take back
  the instance the curtain just retired.
- A pooled layer carries whatever state it left with — fade, visibility,
  curtain clip and extent. The installers set all of those on every incoming
  layer, not only on new ones.

Map z-order, of what is left: backgrounds at the default zIndex 0 (ordered by
collection position), the terrain-analysis render at 1 (`terrainLayer.ts` — over
the background it is read against, under the B half so a curtain can still be
drawn across it), the B half of a two-ground view at 1.5 (`COMPARE_Z`),
the LiDAR footprint outlines
at 3 (`lidarFootprintsLayer.ts`, visible only while the ribbon's dataset menu is
open), the terrain-analysis window frame at 4, and the Kulturminner theme layers
on top at 10 — set by the caller that adds them (`src/map/layers/atoms.ts`), not
by the factory in `themeWMS.ts`. 2 and 5–9 were the old interface's overlays
and are free; a new one should write down what it puts there.

## Kulturminner (theme layers, Riksantikvaren)

Config `src/map/layers/config/themeLayers/culturalHeritage.ts`, registered in
`src/map/layers/themeLayerConfigApi.ts` and in `ThemeLayerName`
(`src/map/layers/themeWMS.ts`). All five are `/wms/ra/<name>` → wmscache →
`kart.ra.no/wms/<name>`.

| Layer id | WMS | What it is |
|---|---|---|
| `heritageSites` | `/wms/ra/kulturminner2` | lokaliteter, enkeltminner, sikringssoner |
| `culturalEnvironments` | `/wms/ra/kulturmiljoer` | kulturmiljøer |
| `sefrakBuildings` | `/wms/ra/sefrak` | SEFRAK-registered buildings |
| `protectedBuildings` | `/wms/ra/freda_bygninger` | fredede bygninger |
| `userReportedHeritage` | `/wms/ra/brukerminner` | user-reported minner |

The category sets `infoFormat: 'application/vnd.ogc.gml'` so
`parseXmlFeatureInfo` (MapServer `msGMLOutput`) produces structured fields;
left unset, the WMS returns HTML and the card shows a placeholder.

`themeLayerEffect` (`src/map/layers/atoms.ts`) puts them on the map, and in the
split view on both maps: a ticked register belongs to the reading rather than to
a half, so `syncThemeLayers` is called once per map and each gets its own layer
instances off the same config. Only the main map's result writes
`?themeLayers=` or drops a reading — the second pane is a mirror.

These five are also the only layers on the map a pointer can question.
`heritageQuery.ts` asks them by id rather than by the `theme.` prefix — who is
asking decides which registers may answer — and `src/heritageInfo/` is what puts
the question and draws the tip and the card. A sublayer that draws but does not
answer is invisible to that surface, and `isRendering` means a register hidden
behind the blind is never asked about.

### What `kulturminner2` exposes

`src/map/layers/heritage.ts` holds the WMS tables and the atoms; two
independent settings, both URL-persisted:

- **Register** (`HERITAGE_DETAILS`): `lokaliteter`, `enkeltminner`,
  `sikringssoner`. Each expands to a polygon sublayer and, except for
  Sikringssoner, its icon twin. The pairing is load-bearing: polygon sublayers
  stop at 1:25 000 (`MaxScaleDenominator`) while icons carry to 1:450 000.
- **Render** (`HERITAGE_RENDERS`): `omriss`, `flate`, then the five vern
  subsets `fredede`, `verneverdige`, `listefoerte`, `utenVern`, `uavklart`.

Rendering is one axis, not two: `STYLES` takes a single value per `LAYERS`
entry and RA publishes no filled variant of any subset, so "filled *and*
fredede only" is not a request that exists. The MapServer `FILTER` vendor
parameter would compose it, but needs the `vernetype` vocabulary enumerated
client-side, where a missed value under-reports silently.

Contracts:

- Style names are not derivable from render names. `Enkeltminner`'s default
  style is the *fill* and `grenser` its outline, the inverse of `Lokaliteter`;
  `Lokalitetsikoner` spells its vern style `Uavklart` where every other
  sublayer spells it `uavklart`. An unpublished style is a ServiceException (a
  wall of broken tiles); a published but empty one is a valid transparent PNG.
- `LAYERS` order is cartography — the WMS paints front to back, so the last
  name wins the pixel — and `PAINT_ORDER` is that order bottom-to-top:
  Sikringssoner, Lokaliteter, Enkeltminner, Lokalitetsikoner,
  Enkeltminneikoner. Grouping the request by register instead puts each
  register's icon under the next register's polygon; RA's own root layer
  `Kulturminner` draws the clean version and is the check.
- `LAYERS` and `STYLES` are positional and must stay the same length.
- `heritageSitesParams` returns null when the settings select nothing (every
  register off, or only Sikringssoner under a vern subset) — hide the layer
  rather than send a request that can only come back empty.

Whether a feature's `linkkulturminnesok` URL resolves is asked separately
(`src/map/featureInfo/kulturminnesok.ts`, `docs/wms-proxy-and-tiles.md`).

## Recipe: add a theme layer

1. A config in `src/map/layers/config/themeLayers/` exporting a
   `ThemeLayerConfig` with `categories[]` and `layers[]`; category defaults
   (`wmsUrl`, `infoFormat`, `featureInfoFields`, …) cascade through
   `getEffectiveWmsUrl` and the fallback chain in `themeWMS.ts`.
2. Merge it into `themeLayerConfig` in
   `src/map/layers/themeLayerConfigApi.ts`.
3. Add the layer id(s) to `ThemeLayerName` in `src/map/layers/themeWMS.ts`;
   they appear in the `Kulturminner` popover automatically, and as a source in
   the overlay's own menu (`src/heritageControls/`), which lists whatever
   `themeLayerConfig` holds.
4. Route the requests through wmscache and use the same-origin
   `/wms/<host-slug>/…` prefix as `wmsUrl` — `docs/wms-proxy-and-tiles.md`.
5. If GetFeatureInfo offers no JSON, set `infoFormat` to something the parser
   handles (`application/vnd.ogc.gml` for MapServer).

## Recipe: add a background layer

1. Add the id to `WMTSLayerName`, `WMSLayerName`, `ArcGISImageLayerName` or
   `XYZLayerName` (`src/map/layers/backgroundLayers.ts`); the matching
   discriminant is the `type` field on `BackgroundLayer` in
   `config/backgroundLayers/types.ts`. A fourth type also needs a builder and a
   `layerSignature` arm in `utils.ts` — without the signature every dataset
   cycle rebuilds the layer instead of reusing it, the pool never holds it, and
   a ground already drawn flashes. A new builder also calls
   `guardTileSource(source, url)` before
   handing the source to the layer, or that ground goes on hammering a dead
   upstream while everything else has stopped — with `{ retry: false }` where a
   404 is the source's own coverage mask (`docs/wms-proxy-and-tiles.md`).
2. Create or extend a config in `src/map/layers/config/backgroundLayers/` and
   spread it into `allConfiguredBackgroundLayers` in `stack.ts`.
   `coverageExtent` is mandatory for anything that can reach an upstream, XYZ
   over `/cache/` included, and `XYZBackgroundLayer` also wants `preload` and
   `sparse` — `docs/wms-proxy-and-tiles.md` for all three. If the source is a fixed
   layer+style, it should be a MapProxy cache rather than a `TileWMS`; that
   recipe is in the same doc.
3. A layer whose concrete source is a runtime choice gets a branch in
   `pickLayerConfig` rather than a static entry, and stays out of
   `VALID_STARTUP_LAYERS`, since a cold load onto it would render nothing.
4. Give it a control. A new member of an existing ground is a row in that arm's
   menu; a ground of its own is a fourth arm plus an entry in `GROUND_MODES`
   and `groundOf` (`src/grounds/`), which is what decides that the arm is the
   one on screen. Until it has either, it is reachable by setting
   `backgroundLayerHalves.a` and by `?backgroundLayer=` if it is safe to
   cold-load onto.
5. Translations in `src/locales/{nb,nn,en}/translation.json`.
