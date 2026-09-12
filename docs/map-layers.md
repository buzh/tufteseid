# Map content — what is drawn, and where it comes from

Everything the map itself puts on screen: four of the five grounds (the
background stack and the services behind each one), the Kulturminner theme
layers, what the public registers can be asked about a rectangle, and the
recipes for adding another of either kind. Read this before touching anything
under `src/map/layers/`, `src/localities/flyfoto*.ts` or
`src/localities/localityContext.ts`.

Two neighbours own the halves this file deliberately doesn't. **How** a request
leaves the browser — the Caddy prefixes, wmscache, the nib-proxy sidecar, the
cache lifetimes, `coverageExtent`, tile grids and the Kartverket rate limit
that dictates all of it — is `wms-proxy-and-tiles.md`; nothing here should be
read as permission to spend more requests. The **controls** — which button is a
mode, which pulldown is a modifier, the W/S rings and the keyboard map — are
`ui-architecture.md` §5, and every section below cites its own contract there.
The float-elevation path (Terrenganalyse) is not a background layer at all:
`terrain-analysis.md` and CLAUDE.md's own Terrenganalyse section.

Facts in this document were paid for once with a live GetCapabilities read or a
GetMap probe. Which style name is capitalised, which mosaic method to state
explicitly, which axis a bbox goes in — none of it is derivable from the
documents the services publish.

## The background stack

A background *mode* is never one layer. `resolveStack` / `buildStack`
(`src/map/layers/config/backgroundLayers/stack.ts`) build one, bottom-first:

1. topo base, for everything in `NEEDS_TOPO_BASE` (both LiDAR modes,
   `flyfotoProject` and `amtskart` — those services return transparent PNGs
   outside coverage). The seamless `flyfoto` mosaic is *not* in that set: it
   covers its whole advertised extent, so a base under it would be invisible
   and still cost a screenful of requests;
2. a seamless fallback at `FALLBACK_OPACITY`, when a *per-project* dataset is
   active, so the area the project doesn't cover keeps its context instead of
   dropping to plain topo. For `lidarProject` that is the national mosaic, so
   the uncovered ground keeps its relief; for `flyfotoProject` it is the
   best-available ortofoto mosaic, i.e. the same ground photographed recently;
3. the active dataset;
4. the topo overlay, in hybrid mode.

`LIDAR_LAYERS` is deliberately *not* `NEEDS_TOPO_BASE`: hybrid and the DTM/DOM
choice are decisions about the LiDAR stack, and writing `?lidarModel=dom` while
looking at a 1937 photograph would be a lie about what's on screen. The URL
follows the resolved stack rather than the atoms for that reason —
`?hybrid=true` and `?contours=true` are written only when the overlay actually
ended up in it.

The split into a pure `resolveStack` (configs only, no map, no network) and an
awaiting `buildStack` is what lets the compare curtain resolve a *second* stack
by the same rules (`src/map/compare/`, `ui-architecture.md` §5.8);
`backgroundLayerAtomEffect` in `config/backgroundLayers/atoms.ts` is just the
first caller, and it also guards against a slow build installing a stack the
user has already cycled past.

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
  that changed. Reused layers may still carry an earlier fade, so the caller
  sets opacity explicitly on every layer it passes in.

Above the whole stack, and below the lokalitet rectangles, the funn and the
Kulturminner theme layers, sits the **ground overlay** —
`src/map/groundOverlay.ts`, a georeferenced `ol/layer/Image` at `zIndex: 1`.
Two things paint into it and only one at a time: a live terrain render, and a
kept bilde pinned to its own rectangle with "Vis i ruta". The module carries
the `owner` tag and the arbiter (pinning stands the render down, entering
Terreng unpins the image); the callers carry neither. The full ordering is
`ui-architecture.md` §10; why the render is a map layer rather than a thumbnail
is CLAUDE.md's Terrenganalyse section, and the visualizations themselves are
`terrain-analysis.md`.

## Standard, and the amtskart series

Standard is five cartographies of the same ground, not one: `topo`,
`topograatone`, `toporaster`, `sjokartraster` (all WMTS out of
`cache.kartverket.no`, one capabilities document between them) and `amtskart`.
`STANDARD_VARIANTS` in
`src/map/layers/config/backgroundLayers/standardVariants.ts` is the ring, the
pulldown order and the type; UI contract in `ui-architecture.md` §5.10. They
are *variants*, not modes — the picker is on the settings strip and the ring is
W/S, like LiDAR datasets and ortofoto acquisitions.

There is no second URL parameter — a variant *is* a layer name, so
`?backgroundLayer=amtskart` covers it, and `standardVariantAtom` seeds itself
from that. Why Standard keeps two pieces of state (what it means vs what is
drawn) is `ui-architecture.md` §5.10.

Amtskartserien: `/wms/geonorge/wms.historiskekart`, layer `amt1` (the seamless
mosaic of the series; the service's other layer, `georefererte`, wants the id
of one specific scanned sheet). Needed no proxy work — the nginx `location
/skwms1/` rule already covers all of `wms.geonorge.no`.

- **It is `TRANSPARENT` and in `NEEDS_TOPO_BASE`.** The series ran 1826 to
  around 1917 and stopped before Nordland was ever mapped: a GetMap probe has
  Bodø and Mosjøen coming back empty while Narvik, Tromsø and Alta draw. Bare,
  that looks like a broken app rather than like a map nobody surveyed.
- GetMap probes against this service need the bbox in **E,N** order for
  EPSG:25833, despite what the layer's own metadata sample URL does.

## LiDAR hillshade (background layer, Kartverket)

A *background*, not a theme layer: the intent is to overlay Kulturminner
objects on top of the terrain relief, so the relief has to be the ground.

- Type registered in `src/map/layers/backgroundLayers.ts` (`lidarHillshade`
  in `WMSLayerName`).
- Config: `src/map/layers/config/backgroundLayers/elevation.ts`
  (`buildNationalLidarConfig`). Built dynamically by `resolveStack` rather than
  as a static entry, because the style comes out of an atom.
- Control: the "LiDAR" `ModeButton` in ribbon row 1; the dataset, style and
  DTM/DOM pulldowns are on the settings strip below it (`RibbonSettingsRow`).
  Strings live under `ribbon.*` in `src/locales/{nb,nn,en}/translation.json`.

The dataset pulldown's default is **Automatisk**: the national 1 m mosaic when
zoomed out, the best-covering per-project dataset (0.25 m) once the view is fine
enough for that to show, unless the user has pinned one. Rules in
`src/map/layers/config/backgroundLayers/lidarAuto.ts`, UI contract in
`ui-architecture.md` §5.7. It is a *pin flag*, not a fourth dataset — the
resolver writes through the same selectors the picker does.

The client hits `/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833`, not
`wms.geonorge.no` directly — same-origin through wmscache, which also avoids
the CORS issues seen calling `wms.geonorge.no` from `fetch()`. Same treatment
for per-project LiDAR at `/wms/geonorge/wms.hoyde-dtm-prosjekt` (see
`lidarProjects.ts`).

### DTM vs DOM

Both the national mosaic and the per-project service exist in a terrain
(DTM) and a surface (DOM) flavour. `activeLidarModelAtom`
(`lidarProjects.ts`) picks between them; persisted as `?lidarModel=dom`,
absent means DTM. Like hybrid it's a modifier rather than a fourth mode; the
control is in `ui-architecture.md`.

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
  so it comes back on the way out.

The LiDAR *extract* tool stays DTM-only (`lidarExtract/sources.ts` pins
`LIDAR_PROJECT_WMS_URL.dtm`): an extract is meant to be read as terrain.

## Hybrid mode

The same LiDAR stack with Kartverket's roads/railways/place-names drawn
transparently on top, for working out *where* a feature is without leaving the
terrain. State is `hybridOverlayAtom`, persisted as `?hybrid=true`. It is a
*modifier* on the background, not a background of its own, so dataset, style
and cycling all keep working underneath it — see `ui-architecture.md` for the
control and why that distinction matters.

Config: `backgroundLayers/topoOverlay.ts` — `buildTopoOverlayConfig(contours)`
over `/wms/geonorge/wms.topo` with `TRANSPARENT=TRUE`. `LAYERS` is always the
five reference groups `kd_veger,kd_jernbane,kd_stedsnavn,fkb_samferdsel,`
`fkb_presentasjonsdata`. Asking that WMS for a subset of its groups yields a
real overlay: no terrain, no landcover, no background fill. Both families are
needed — the generalized `kd_*` groups stop rendering around 1:25 000 and the
`fkb_*` ones take over.

**Høydekurver** append `kd_hoydekurver,fkb_hoydekurver` to that same `LAYERS`
value. State is `hybridContoursAtom`, persisted as `?contours=true`, and the
control is a `Switch` on the settings strip rendered only in Hybrid — the
lines ride on the overlay's own GetMap, so in plain LiDAR there is no request
for them to join. That merge is the point: a second `TileWMS` would double the
overlay's request count against a rate limit shared by every visitor, and the
cost paid instead — toggling re-requests the reference groups once, since
`buildOrReuseBackgroundLayer` keys on the params — is a one-off. The same
`kd_`/`fkb_` handover applies and was re-measured per group, not assumed;
`hoydekurver_1m` / `hoydekurver_5m` are the raw feature layers behind them and
render nothing at any scale.

Alternatives already ruled out: `cache.kartverket.no`'s WMTS has no
transparent overlay layer (only full basemaps), `wms.topo4` is dead, and NiB
needs an API token.

## Flyfoto (Norge i bilder ortofoto)

Two distinct things, on the same imagery:

1. **A background mode** — "Flyfoto" in ribbon row 1, beside Standard / LiDAR
   / Hybrid, with the same shape of dataset pulldown (on the settings strip)
   and W/S cycling. Just *looking*, so no licensing notice. Layer plumbing
   below; the control is in `ui-architecture.md` §5.5.
2. **A lokalitet action** — "Flyfoto" in the lokalitet row stitches NiB
   ortofoto over the authored bbox and *keeps* it as an attachment of kind
   `flyfoto`. Gated by the licensing notice, every time.

The old TopBar "Flyfoto ↗" external link is gone — it navigated out of the app
to do worse than what the background mode now does in place.

### The background mode

Two dynamic branches of the stack resolver
(`backgroundLayers/flyfotoBackground.ts`), no static entry in
`allConfiguredBackgroundLayers`, exactly like the LiDAR pair:

- `flyfoto` — the seamless best-available mosaic, a plain `TileWMS` on
  `/wms/nib/ortofoto`.
- `flyfotoProject` — one acquisition. **Not a WMS**: NiB publishes no
  per-project WMS, so this is `ol/source/TileArcGISRest` against
  `/arcgis/nib/ortofoto_prosjekter/ImageServer/exportImage` with
  `mosaicRule = {"mosaicMethod":"esriMosaicNone","where":"prosjektnavn='…'"}`.
  `esriMosaicNone` is load-bearing — the default method blends neighbouring
  projects back in, and the symptom is a picked year that looks almost right.
  It stays out of `VALID_STARTUP_LAYERS` for the same reason `lidarProject`
  does: its concrete acquisition starts null.

`coverageExtent` comes from `project.bboxLonLat` per acquisition and a Norway
extent for the mosaic. Cache rules for this request profile:
`wms-proxy-and-tiles.md`.

### The lokalitet grab

The stitch (`src/localities/flyfoto.ts`) reuses the LiDAR extract machinery
(`planTiles` / `fetchAndPaint` / `runWithConcurrency` from
`src/lidarExtract/stitch.ts`) — WMS 1.3.0 GetMap, EPSG:25833, JPEG, target
0.2 m/px, per-tile retry. `fetchAndPaint`'s uniform-image check drops
no-coverage tiles, so a bbox entirely outside coverage returns null and the
UI says so.

Request path is same-origin like every other raster source:
`/wms/nib/ortofoto` → Caddy → wmscache → **nib-proxy** →
`services.norgeibilder.no/wms/ortofoto` (layer name `ortofoto`,
`FLYFOTO_LAYER`). Old NiB WMS endpoints die **Sep 2026**; this uses the new
`services.norgeibilder.no/wms/*`. Token handling is the sidecar's job — see
`wms-proxy-and-tiles.md`.

Licensing: NiB imagery is free for private, non-commercial use;
publishing/commercial use is the user's responsibility. A notice dialog gates
every **grab** (`localities.tools.flyfotoNotice*`), by deliberate product
decision — this facilitates personal use, akin to hitting print. Attribution
lives in that prose, not the chrome. Browsing the same imagery as a background
is not a grab and deliberately has no notice.

`attachments.kind` includes `flyfoto` (migration
`1700000300_attachments_flyfoto.js`; `AttachmentKind` in
`src/api/attachments.ts`; `KIND_ICON` in `BilderSection.tsx`).

### Per-project flyfoto (every acquisition covering a lokalitet)

Besides the single seamless best mosaic (`LAYERS=ortofoto`) above, the
"Flyfoto" action offers a temporal stack — every ortofoto acquisition
intersecting the lokalitet bbox, the same ground in 1937, 1963 and 2024, each
stitched as its own `flyfoto` Bilde.

**Discovery overturned the two-service model this was planned around.** Both
halves live on NiB, and neither is a WMS:

| Purpose | Service | Proxy path |
|---|---|---|
| Which acquisitions cover here | `prosjekter/MapServer/4/query` (layer 4 = "Prosjektomriss prosessert") | `/arcgis/nib/` |
| The imagery pixels for one of them | `ortofoto_prosjekter/ImageServer/exportImage` | `/arcgis/nib/` |
| The seamless mosaic | `services.norgeibilder.no/wms/ortofoto` | `/wms/nib/` |

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

**Infra.** The sidecar routes `/arcgis/*` to NiB's REST base and everything
else to its WMS base; chain is `/arcgis/nib/*` (Caddy) → `/nib-arcgis/*`
(nginx) → `/arcgis/*` (sidecar). Routing and per-endpoint cache lifetimes:
`wms-proxy-and-tiles.md`.

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

The batch grab runs **sequentially** — one project's tile burst already
saturates `MAX_CONCURRENT` against the shared NiB edge. `meta` records
`projectName` / `year` / `photoDate` so the gallery can caption "Flyfoto 1937".
The picker, the licensing gate and the batch cap are UI: `ui-architecture.md`
§8.8; the period chips over the same list are §5.5.

## Kulturminner (theme layers, Riksantikvaren)

Config: `src/map/layers/config/themeLayers/culturalHeritage.ts`. Registered as
`themeLayerConfig` in `src/map/layers/themeLayerConfigApi.ts` and in the layer
id union in `themeWMS.ts` (`ThemeLayerName`).

Five layers under the "Kulturminner" theme category, one per Riksantikvaren
WMS service. URLs are same-origin (`/wms/ra/<name>`) and routed through
`wmscache` to `kart.ra.no/wms/<name>`: `kulturminner2` (sites + monuments),
`kulturmiljoer`, `sefrak`, `freda_bygninger`, `brukerminner`.

`kulturminner2` is the one the user can reshape rather than just switch on.
`src/map/layers/heritage.ts` holds the WMS tables — which of its six sublayers
each of the three registers (lokaliteter / enkeltminner / sikringssoner)
expands to, and the STYLES value each render maps to per sublayer — plus the
three atoms and their URL persistence. Everything in it was read off live
GetCapabilities and confirmed with GetMap probes, because both failure modes
are hard to read from the document: an **unpublished** style is a
ServiceException (loud, but a wall of broken tiles), and a **published but
empty** style is a valid transparent PNG (indistinguishable from "no data",
which for a vern subset is the correct answer). Do not derive a style name
from a render name — `Enkeltminner`'s default is the *fill* and `grenser` is
its outline, the inverse of `Lokaliteter`, and `Lokalitetsikoner` spells its
vern style `Uavklart` where every other sublayer spells it `uavklart`.

The order of the `LAYERS` list is **cartography, not bookkeeping** — the WMS
paints it front to back, so the last name wins the pixel. `PAINT_ORDER` in the
same module is that order, bottom to top: Sikringssoner, Lokaliteter,
Enkeltminner, then the two icon layers. It is a second axis from the
register → sublayer table beside it and deliberately separate: that table is
grouped by register so the polygon/icon pairing is visible, and building the
request straight out of it puts each register's icon under the *next*
register's polygon. The symptom was the dark blue R of a lokalitet coming back
with the enkeltminne's periwinkle mark painted over its face — two marks on one
point, the one you were aiming at underneath. The check is RA's own root layer
`Kulturminner`, which draws the clean R; if a change here makes the two
disagree at a single-monument lokalitet, the order is wrong again.

Rendering is deliberately **one axis** (outlines / filled / five vern subsets),
not two: STYLES takes a single value per LAYERS entry and RA publishes no
filled variant of any subset, so "filled *and* fredede only" is not a request
that exists. FILTER (the MapServer OGC vendor parameter) does work on kart.ra.no
and would compose, but it needs the `vernetype` *text* vocabulary enumerated
client-side — and a value missed there under-reports silently, where a wrong
style is a ServiceException. UI contract: `ui-architecture.md` §5.9.

Feature-info: the category sets `infoFormat: 'application/vnd.ogc.gml'` so
the existing `parseXmlFeatureInfo` (which handles MapServer `msGMLOutput`)
kicks in and shows structured fields. Left unset, the WMS returns HTML,
which the parser wraps as `{ _html: ... }` and the UI shows an unhelpful
"HTML-respons mottatt" placeholder.

## What the registers already know about a rectangle

Two lookups that are not layers: they ask the public registers, in text, what
is at a place, and the answers land in a lokalitet's fields or in a readout
beside it.

### Sted / kommune / matrikkel

`src/localities/localityContext.ts` asks three anonymous GeoNorge endpoints
what a rectangle is — `stedsnavn/v1/punkt`, `kommuneinfo/v1/punkt`,
`eiendom/v1/punkt`, in parallel, centre-plus-radius, over `ws.geonorge.no`
directly (already in the CSP, a few kB each, not worth a wmscache route).
`createLocalityFromBbox` awaits it *before* writing the record, so a new
lokalitet arrives named after the nearest stedsnavn with its three fields
filled; UI consequences are `ui-architecture.md` §8.3, and the policy around
those fields (pre-fill, not derivation; the centre coordinate deliberately not
stored) is in CLAUDE.md.

- **Never fatal, never slow.** Every lookup degrades to `''` and the whole
  thing is capped at 6 s. A lokalitet at sea, across the border or during a
  GeoNorge outage is still a lokalitet.
- **Type, not distance, picks the name.** `navneobjekttype` is sorted into
  deny (administrative and statistical geography), promote (gard, seter, tuft,
  heller, …) and demote (built infrastructure) tiers, drawn from the register's
  own 291-type vocabulary; the neutral middle is the natural landscape and
  settlement words. Without that, cities auto-name lokaliteter "Oslo Spektrum"
  and coasts name them after vannstandsmålere. Only `stedstatus = aktiv` names
  are eligible, and a place with no `hovednavn` picks a settled spelling over
  the first `foreslått` one.
- `/eiendom/v1/punkt`, **not** `/punkt/omrader` — same list, minus teig
  polygons nothing draws (4.5 kB vs 249 kB). Parcels with gnr ≥ 9000 (road,
  rail, watercourse) and null-gnr water surfaces are dropped; the kommune
  number is only prefixed on parcels outside the resolved kommune.

### Kjente kulturminner her — removed

There was a `src/api/kulturminnerWfs.ts` asking GeoNorge's redistribution of
the kulturminner register (`/wfs/geonorge/wfs.kulturminner`, feature type
`app:Lokalitet`, GML 3.2 only, DOM-parsed — kart.ra.no has WFS disabled) what
was already registered inside a lokalitet's rectangle, and rendering the
answer as a list. It is gone; `docs/ui-architecture.md` §15 records why.

If a text readout of that register is ever wanted again, the endpoint above is
the one that works, and `/wfs/geonorge/` is still routed (it is how
`lidarFootprints.ts` gets project boundaries). But the register is already on
the map as `kulturminner2`, clickable through GetFeatureInfo (§ the theme
layers above), which is the form this app is actually about.

## Adding another theme layer

1. Create a config file in `src/map/layers/config/themeLayers/`. Export a
   `ThemeLayerConfig` with `categories[]` and `layers[]`. Category holds
   shared defaults (`wmsUrl`, `infoFormat`, `featureInfoFields`, etc.) that
   cascade to layers via `getEffectiveWmsUrl` and the fallback chain in
   `themeWMS.ts`.
2. Import it in `src/map/layers/themeLayerConfigApi.ts` and merge it into the
   exported `themeLayerConfig` (today that is the Kulturminner config
   outright, since it is the only one).
3. Add the layer id(s) to `ThemeLayerName` in `src/map/layers/themeWMS.ts`.
   It will appear in the popover on `Kulturminner` automatically — that
   list is `themeLayerConfig.layers`.
4. Route requests through `wmscache` rather than hitting the origin from the
   browser, and use the same-origin `/wms/<host-slug>/...` prefix as `wmsUrl`
   (recipe in `wms-proxy-and-tiles.md`).
5. If the WMS's GetFeatureInfo doesn't offer JSON, set `infoFormat` on the
   category or layer to a format the parser can handle
   (`application/vnd.ogc.gml` works for MapServer via `parseXmlFeatureInfo`).

## Adding another background layer

1. Add id to the appropriate name union in
   `src/map/layers/backgroundLayers.ts` — `WMTSLayerName`, `WMSLayerName` or
   `ArcGISImageLayerName`. The last is for ESRI ImageServer sources
   (`TileArcGISRest` + a `mosaicRule`), which is how per-acquisition ortofoto
   works; `LayerType` in `config/backgroundLayers/types.ts` is the matching
   discriminant.
2. Create/extend a config in `src/map/layers/config/backgroundLayers/` and
   spread it into `allConfiguredBackgroundLayers` in `stack.ts`. For a WMS or
   ArcGISImage layer, `coverageExtent` is mandatory — see
   `wms-proxy-and-tiles.md`. A layer whose concrete source is chosen at
   runtime (`lidarProject`, `flyfotoProject`) instead gets a branch in
   `pickLayerConfig`, no static entry, and stays out of
   `VALID_STARTUP_LAYERS` — a cold load onto it would render nothing.
3. Give it a control in ribbon row 1 (`src/shell/RibbonGlobalRow.tsx`). There
   is no thumbnail gallery any more: a *mode* is a `ModeButton` in row 1, and
   a choice *within* a mode is a `Pulldown` on the settings strip
   (`src/shell/RibbonSettingsRow.tsx`) — see `src/shell/lidar/` and
   `src/shell/flyfoto/` for the two worked examples, incl. how a dataset ring
   registers itself for W/S cycling). Decide which of the two it is before
   writing anything — `ui-architecture.md` §5.2 on modes vs modifiers.
4. Add translations under `ribbon.*` in
   `src/locales/{nb,nn,en}/translation.json`.
