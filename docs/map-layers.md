# Map content — what is drawn, and where it comes from

The background grounds and the services behind them, the Kulturminner theme
layers from Riksantikvaren, and the three public point registers a rectangle
can be described with. Read before touching `src/map/layers/`,
`src/localities/flyfoto*.ts` or `src/localities/localityContext.ts`. Proxying,
caching, tile grids and the Kartverket rate limit are
`docs/wms-proxy-and-tiles.md`; the float-elevation path behind Terreng is
`docs/terrain-analysis.md`; the controls are `docs/ui-architecture.md`.

All WMS requests are `VERSION=1.3.0`, same-origin through a `/wms/…` prefix.
Nothing sets `SRS`/`CRS` by hand — OpenLayers writes it from the view
projection, `EPSG:25833` by default (`DEFAULT_PROJECTION`, `src/map/atoms.ts`);
`coverageExtent` declares its own CRS and is transformed to that projection.

## The grounds

`GROUND_MODES` (`src/shell/useGroundMode.ts`) is `lidar`, `terreng`, `kart`,
`hybrid`, `flyfoto`. `terreng` — labelled **Analyse** on the ribbon, beside
LiDAR — is not a background layer but a client-rendered overlay over whatever
background is set. A cold load with no `?backgroundLayer`
arrives on `lidarHillshade`, the national relief mosaic
(`getDefaultBackgroundLayer`, `config/backgroundLayers/atoms.ts`): reading
relief is what the app is for, and Automatisk takes it to a per-project dataset
from there.

| Ground | Layer name(s) | Service / prefix | Dataset ring (W/S) |
|---|---|---|---|
| LiDAR | `lidarHillshade` (national mosaic) | `/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833` (prefix `NHM_DTM_TOPOBATHY_25833`), DOM: `wms.hoyde-dom-nhm-25833` (`NHM_DOM_25833`) | Automatisk / national / per-project |
| LiDAR | `lidarProject` (0.25 m per acquisition, rendered by the WMS) | `/wms/geonorge/wms.hoyde-dtm-prosjekt`, DOM: `wms.hoyde-dom-prosjekt`; `LAYERS=<project id>:<style>` | same ring |
| LiDAR | `lidarCvat` (the same acquisition, rendered by us: **Arkeologisk relieff**) | `/cvat/<acquisition>/{z}/{x}/{y}.webp` — our own tile store, served off disk, no service behind it | not on it — it is the `cvat` entry of the style ring (A/D) |
| Analyse | — | `/arcgis/hoydedata/*`, see `docs/terrain-analysis.md` | the visualization list |
| Kart | `topo`, `topograatone`, `toporaster`, `sjokartraster` (WMTS) | `cache.kartverket.no/v1/service` GetCapabilities, one document for all four | the five `KART_VARIANTS` |
| Kart → Amtskart | `amtskart` (WMS, `LAYERS=amt1`, 1:200 000) | `/wms/geonorge/wms.historiskekart` | same ring |
| Hybrid | `topoOverlay` (modifier, not a ground of its own) | `/wms/geonorge/wms.topo`, `TRANSPARENT=TRUE` | the LiDAR ring underneath |
| Flyfoto | `flyfoto` (seamless mosaic, `LAYERS=ortofoto`, `FORMAT=image/jpeg`) | `/wms/nib/ortofoto` | ortofoto acquisitions |
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
- `lidarCvat` is not a service. `vat-cache/vatcache.py` runs RVT over an
  acquisition's DTM and writes the combined VAT — hillshade, slope, positive
  openness, sky-view in one picture — as 512 px RGBA WebP on the app's own tile
  grid, down to z12 (5.289 m/px), with `/cvat/manifest.json` beside the tiles
  recording presets, blend order, per-level radii, the run's digest and which
  acquisitions are in the store, at which levels, in which directory. How deep
  the ladder goes is the acquisition's own: z16 (0.331 m/px) where hoydedata.no
  publishes a 0.25 m DTM, z15 (0.661 m/px) where it publishes 0.5 m, because
  below the DEM's cell the picture is of the interpolation. Caddy's
  `file_server` serves the bind-mounted store, so there is no proxy route, no
  wmscache entry and no CSP host. Radii are RVT pixels at every level, so an
  acquisition's levels are related pictures of the same terrain rather than one
  picture at several sizes: the reach of the visualization grows as you zoom
  out, and the tooltip says so.
- **Acquisitions may overlap, and two rows is the point.** Each owns a directory
  in the store — the manifest's `path`, which is the whole tile template the app
  builds — so a 5 pkt flight from 2021 and a 10 pkt one from 2025 over the same
  landscape are two readings of it, both offered, neither overwriting the other.
  They are two rows because they are two *flights*, ranked against each other by
  coverage, year and density like any other pair; the store having rendered both
  adds no row and breaks no tie. Ladder depth is not a tiebreak, because it is
  not independent of the ranking — z16 exists only where hoydedata publishes a
  0.25 m DTM, which is where the denser, newer flight already wins.
- **The store is read at runtime, not compiled in.** `fetchCvatStore()` reads
  `/cvat/manifest.json` once per page load and `resolveCvatAcquisitions()`
  joins its `acquisitions` block to the LiDAR catalogue, so a batch run that
  lands on the server is in the app on the next reload with no deploy and no
  code change. An acquisition the catalogue does not publish is dropped with a
  warning — without its row there is no footprint to rank it by and no envelope
  to cull with. An install without a store answers 404, which parses as an
  empty store: no cached rows anywhere, rather than a dataset that is offered
  and draws nothing. Levels are per acquisition, so a half-built one draws at
  the levels it has and nowhere else.
- It is the one ground whose relief nobody upstream computed, so it is the one
  that has to say where it came from. The dataset chip's tooltip names the
  acquisition beside the label; a kartutsnitt taken over it records which
  acquisition was showing (`meta.cvatAcquisition`) and carries it on its
  provenance plate, with the renderer, the template, the blend
  stack, the combine and the pixel radii, and credits Kartverket under
  `høydedata` rather than `skyggerelieff` — the height values are theirs, the
  picture is not. The constants the plate prints live beside the layer config in
  `cvatGround.ts` (`CVAT_RENDERER`, `CVAT_TEMPLATE`, `CVAT_STACK`,
  `CVAT_AZIMUTH`, `CVAT_SUN_ALTITUDE`, `CVAT_RADIUS_PX`,
  `CVAT_GENERAL_OPACITY`), transcribed from the manifest rather than fetched
  from it: a downloaded figure travels off this host. Rebuilding the store under
  changed parameters — a new digest in the manifest — means editing that block
  too.
- Its coverage needs no polygon. The layer's `extent` is the showing
  acquisition's own envelope and culls everything outside; inside it the ~94 %
  that were never written answer 404, OpenLayers marks those tiles errored and
  leaves them transparent, and the faded national mosaic underneath shows
  through. `maxResolution` hides the layer one step coarser than the
  acquisition's coarsest level rather than letting OL clamp and ask for four
  screenfuls to upscale. The whole store is one `<z>/<x>/<y>` namespace and a
  tile carries no provenance, so where two acquisitions' envelopes overlap the
  layer draws the neighbour's tiles: the picture is the same product either way
  — one recipe, one digest — and what it costs is the name on a figure plate,
  in the sliver where one envelope covers the other's ground.
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
  (`cvatGround.ts`), halved like the LiDAR project and seeded into the compare
  curtain's B side with it. It is written only in lockstep with
  `activeLidarProjectAtom`, by `selectProject` — the flight is the choice and
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
  contours rather than a second `TileWMS`. The published `hoydekurver_1m` /
  `_5m` are raw feature layers and render nothing at any scale.
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
  responsibility; `localities.tools.flyfotoNotice*` gates every grab, never
  browsing.

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

- `resolveStack` is pure and `buildStack` awaits, so the compare curtain
  (`src/map/compare/`) resolves a second stack by the same rules.
- The URL follows the *resolved* stack, not the atoms: `?hybrid=true` and
  `?contours=true` are written only when the overlay ended up in it.
- Outgoing layers are dimmed to `OUTGOING_OPACITY` and removed on the next
  `rendercomplete` (`SWAP_TIMEOUT_MS`, 15 s, as a backstop); tearing down first
  makes every W/S step flash topo.
- `buildOrReuseBackgroundLayer` reuses a layer whose url + params + projection
  match, so cycling rebuilds only what changed — and a reused layer may carry
  an earlier fade, so callers set opacity explicitly on every layer they pass.

Map z-order: backgrounds at the default zIndex 0 (ordered by collection
position), the ground overlay at 1 (`src/map/groundOverlay.ts`), the compare
curtain at 1.5, sketches at 2, measure at 3, lokalitet rectangles at 4, the funn
highlight at 4.5, funn at 5, the search marker at 6, the bbox handles at 8, and
the Kulturminner theme layers on top at 10 — set by the caller that adds them
(`src/map/layers/atoms.ts`), not by the factory in `themeWMS.ts`. The ground
overlay is itself an ordered stack composited into one canvas —
`docs/ui-architecture.md`.

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
left unset, the WMS returns HTML and the popup shows a placeholder.

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

## What the registers know about a point

`src/localities/localityContext.ts` asks three anonymous GeoNorge endpoints in
parallel, over `ws.geonorge.no` directly (already in the CSP, a few kB each,
not worth a wmscache route). `createLocalityFromBbox` awaits the result before
writing the record, so a new lokalitet arrives named after the nearest
stedsnavn with its place, kommune and matrikkel fields filled.

| Endpoint | Answers |
|---|---|
| `stedsnavn/v1/punkt` | place names near the centre, point + radius |
| `kommuneinfo/v1/punkt` | the kommune |
| `eiendom/v1/punkt` | matrikkel parcels, point + radius |

- Never fatal, never slow: every lookup degrades to `''` and the whole thing is
  capped at `TIMEOUT_MS` (6 s). A lokalitet at sea, across the border or during
  a GeoNorge outage is still a lokalitet.
- Type, not distance, picks the name. `navneobjekttype` is sorted into three
  tiers drawn from the register's own 291-type vocabulary
  (`ws.geonorge.no/stedsnavn/v1/navneobjekttyper`): deny (administrative and
  statistical geography — Kommune, Fylke, Poststed, Grunnkrets, …), promote
  (Gard, Bruk, Seter/støl, Tuft, Heller, Gammel bosettingsplass, …, worth
  `PROMOTE_BONUS_M` and no more) and demote (built infrastructure). Anything
  unlisted is the neutral middle, the natural-landscape vocabulary. Without the
  tiers, cities name lokaliteter after venues and coasts after
  vannstandsmålere.
- Only `stedstatus = aktiv` names are eligible; a place with no `hovednavn`
  picks a settled spelling over the first `foreslått` one.
- `/eiendom/v1/punkt`, not `/punkt/omrader` — the same list minus teig polygons
  nothing draws (4.5 kB vs 249 kB). Parcels with gnr ≥ 9000 (road, rail,
  watercourse) and null-gnr water surfaces are dropped, the kommune number is
  prefixed only outside the resolved kommune, and the list is capped at
  `MAX_MATRIKKEL` (8).

## Recipe: add a theme layer

1. A config in `src/map/layers/config/themeLayers/` exporting a
   `ThemeLayerConfig` with `categories[]` and `layers[]`; category defaults
   (`wmsUrl`, `infoFormat`, `featureInfoFields`, …) cascade through
   `getEffectiveWmsUrl` and the fallback chain in `themeWMS.ts`.
2. Merge it into `themeLayerConfig` in
   `src/map/layers/themeLayerConfigApi.ts`.
3. Add the layer id(s) to `ThemeLayerName` in `src/map/layers/themeWMS.ts`;
   they appear in the `Kulturminner` popover automatically.
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
   cycle rebuilds the layer instead of reusing it, and a ground already drawn
   flashes.
2. Create or extend a config in `src/map/layers/config/backgroundLayers/` and
   spread it into `allConfiguredBackgroundLayers` in `stack.ts`.
   `coverageExtent` is mandatory for WMS and ArcGISImage layers —
   `docs/wms-proxy-and-tiles.md`.
3. A layer whose concrete source is a runtime choice gets a branch in
   `pickLayerConfig` rather than a static entry, and stays out of
   `VALID_STARTUP_LAYERS`, since a cold load onto it would render nothing.
4. Give it a control: a ground is a `ModeButton` in
   `src/shell/RibbonGlobalRow.tsx`, a choice within a ground a `Pulldown` on
   `src/shell/RibbonSettingsRow.tsx`. `src/shell/lidar/` and
   `src/shell/flyfoto/` are the worked examples, W/S ring included.
5. Translations under `ribbon.*` in
   `src/locales/{nb,nn,en}/translation.json`.
