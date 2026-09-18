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

`GROUND_MODES` (`src/shell/useGroundMode.ts`) is `lidar`, `kart`, `hybrid`,
`flyfoto`, `terreng`. Terreng is not a background layer but a client-rendered
overlay over whatever background is set. A cold load with no `?backgroundLayer`
arrives on `lidarHillshade`, the national relief mosaic
(`getDefaultBackgroundLayer`, `config/backgroundLayers/atoms.ts`): reading
relief is what the app is for, and Automatisk takes it to a per-project dataset
from there.

| Ground | Layer name(s) | Service / prefix | Dataset ring (W/S) |
|---|---|---|---|
| LiDAR | `lidarHillshade` (national mosaic) | `/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833` (prefix `NHM_DTM_TOPOBATHY_25833`), DOM: `wms.hoyde-dom-nhm-25833` (`NHM_DOM_25833`) | Automatisk / national / per-project |
| LiDAR | `lidarProject` (0.25 m per acquisition) | `/wms/geonorge/wms.hoyde-dtm-prosjekt`, DOM: `wms.hoyde-dom-prosjekt`; `LAYERS=<project id>:<style>` | same ring |
| Kart | `topo`, `topograatone`, `toporaster`, `sjokartraster` (WMTS) | `cache.kartverket.no/v1/service` GetCapabilities, one document for all four | the five `KART_VARIANTS` |
| Kart → Amtskart | `amtskart` (WMS, `LAYERS=amt1`, 1:200 000) | `/wms/geonorge/wms.historiskekart` | same ring |
| Hybrid | `topoOverlay` (modifier, not a ground of its own) | `/wms/geonorge/wms.topo`, `TRANSPARENT=TRUE` | the LiDAR ring underneath |
| Flyfoto | `flyfoto` (seamless mosaic, `LAYERS=ortofoto`, `FORMAT=image/jpeg`) | `/wms/nib/ortofoto` | ortofoto acquisitions |
| Flyfoto | `flyfotoProject` (one acquisition; `TileArcGISRest`, not WMS) | `/arcgis/nib/ortofoto_prosjekter/ImageServer` | same ring |
| Terreng | — | `/arcgis/hoydedata/*`, see `docs/terrain-analysis.md` | the visualization list |

Configs live in `src/map/layers/config/backgroundLayers/`: `kvCache.ts` (WMTS
cartographies), `kartVariants.ts` (the ring, `AMTSKART_CONFIG`),
`elevation.ts` + `lidarProjects.ts`, `topoOverlay.ts`, `flyfotoBackground.ts`.
Name unions are in `src/map/layers/backgroundLayers.ts`.

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
   `lidarHillshade`, `flyfotoProject`, `amtskart` — all return transparent PNGs
   outside coverage);
2. a seamless fallback at `FALLBACK_OPACITY` when a per-project dataset is
   active — the national mosaic under `lidarProject`, the best-available
   ortofoto mosaic under `flyfotoProject`;
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

1. Add the id to `WMTSLayerName`, `WMSLayerName` or `ArcGISImageLayerName`
   (`src/map/layers/backgroundLayers.ts`); the matching discriminant is the
   `type` field on `BackgroundLayer` in `config/backgroundLayers/types.ts`.
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
