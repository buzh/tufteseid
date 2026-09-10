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

## Companion docs

- `docs/ui-architecture.md` — **the whole user interface**: the floating shell
  and its slot geometry, the ribbon and its rows, the lokalitet surfaces,
  drawing, the analysis panels, search, state and URL persistence, the keyboard
  map, and an exhaustive inventory of every user-facing action as the contract
  a redesign has to honour. The UI renders entirely through the in-repo
  `src/ui` kit — plain CSS Modules over `src/ui/tokens.css`, no component
  library. §12 of that doc records the migration off kvib and the primitives
  deliberately not built. **Read it before touching anything under `src/`
  that renders**, and don't reach for a new UI dependency: the workstation
  can't regenerate `package-lock.json`.
- `docs/wms-proxy-and-tiles.md` — how map requests are proxied (Caddy →
  wmscache → upstream, nib-proxy), the nginx cache rules, and the
  tile-loading constraints that keep request counts under Kartverket's rate
  limit. **Read it before touching `Caddyfile`, `nginx/`, `nib-proxy/`, tile
  grids, or adding a new external map source.** That machinery is working;
  its details are deliberately out of this file.
- `docs/terrain-analysis.md` — how we get **float elevation** (not shaded
  PNGs) out of hoydedata.no, the endpoint's quirks, and the designs for the
  two bigger analysis builds (a server-side RVT sidecar, a QGIS export) plus
  the Norwegian data sources still unused. **Read it before touching
  `src/terrain/`** or before adding another elevation-derived visualization.
- `docs/analysis-roadmap.md` — status of the "what more can we do with a
  lokalitet" thread: the tier model (0 built, 1–2 designed), the open-source
  GIS tool survey with verdicts and licences, and what's worth building next.
  **Read it before proposing a new analysis feature** — it records what was
  already rejected and why, so those don't get re-litigated.
- `README.md` — third-party-facing install and admin guide (first-run
  PocketBase setup, OAuth, TLS, backup, troubleshooting). Keep it accurate
  when any of that changes.

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

Standard rebuild on the server:

```
git pull
docker compose build --pull tufteseid
docker compose up -d
docker compose logs -f tufteseid wmscache
```

If anything under `nginx/` changed, also `docker compose restart wmscache` —
the configs are bind-mounted but nginx only reads them at startup, and
`docker compose up -d` doesn't recreate the container.

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
- **nib-proxy** — token-injecting sidecar for Norge i bilder (NiB) ortofoto.
  Only reachable from wmscache on the compose network.
- **wmscache** — `nginx:1.27-alpine` reverse proxy + 25 GB disk cache in
  front of every external WMS/WFS/ArcGIS service the SPA uses (Kartverket,
  Riksantikvaren, matrikkel, NiB). Caddy exposes each upstream under a
  same-origin prefix (`/wms/geonorge/…`, `/wms/ra/…`, `/wms/nib/…`,
  `/arcgis/nib/…`), so no external map host appears in the Caddyfile CSP.

  Details, rules and verification commands: `docs/wms-proxy-and-tiles.md`.

## Tile loading

Map performance rests on spending *few* WMS requests — Kartverket rate-limits
GetMap per source IP (i.e. per server, shared across all visitors) and signals
it with an HTTP 200 that OpenLayers turns into a permanently errored tile. The
countermeasures (512 px tile grids, `maxTilesLoading`, `preload`,
`coverageExtent` culling, cached no-data tiles, stock OL tile loading) are all
load-bearing and documented in `docs/wms-proxy-and-tiles.md`. Read that before
changing tile grids, layer preloading, or anything that multiplies request
counts.

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

A *background*, not a theme layer: the intent is to overlay Kulturminner
objects on top of the terrain relief, so the relief has to be the ground.

- Type registered in `src/map/layers/backgroundLayers.ts` (`lidarHillshade`
  in `WMSLayerName`).
- Config: `src/map/layers/config/backgroundLayers/elevation.ts`. Built by a
  dynamic branch in `backgroundLayerAtomEffect` (`atoms.ts`) rather than a
  static entry, because the style comes out of an atom.
- Control: the "LiDAR" `ModeButton` in ribbon row 1, with the dataset, style
  and DTM/DOM pulldowns beside it. Strings live under `ribbon.*` in
  `src/locales/{nb,nn,en}/translation.json`.

The dataset pulldown's default is **Automatisk**: the national 1 m mosaic when
zoomed out, the best-covering per-project dataset (0.25 m) once the view is fine
enough for that to show, unless the user has pinned one. Rules in
`src/map/layers/config/backgroundLayers/lidarAuto.ts`, UI contract in
`docs/ui-architecture.md` §5.7. It is a *pin flag*, not a fourth dataset — the
resolver writes through the same selectors the picker does.

The client hits `/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833`, not
`wms.geonorge.no` directly — same-origin through wmscache, which also avoids
the CORS issues seen calling `wms.geonorge.no` from `fetch()`. Same treatment
for per-project LiDAR at `/wms/geonorge/wms.hoyde-dtm-prosjekt` (see
`lidarProjects.ts`).

### The background stack

`backgroundLayerAtomEffect` builds a stack, bottom-first, not a single layer:

1. topo base, for everything in `NEEDS_TOPO_BASE` (both LiDAR modes and
   `flyfotoProject` — those services return transparent PNGs outside coverage).
   The seamless `flyfoto` mosaic is *not* in that set: it covers its whole
   advertised extent, so a base under it would be invisible and still cost a
   screenful of requests;
2. the national mosaic at `FALLBACK_OPACITY`, when a *per-project* dataset is
   active, so the area the project doesn't cover keeps its relief instead of
   dropping to plain topo;
3. the active dataset;
4. the topo overlay, in hybrid mode.

`LIDAR_LAYERS` is deliberately *not* `NEEDS_TOPO_BASE`: hybrid and the DTM/DOM
choice are decisions about the LiDAR stack, and writing `?lidarModel=dom` while
looking at a 1937 photograph would be a lie about what's on screen.

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

The same LiDAR stack with Kartverket's roads/railways/place-names drawn
transparently on top, for working out *where* a feature is without leaving the
terrain. State is `hybridOverlayAtom`, persisted as `?hybrid=true`. It is a
*modifier* on the background, not a background of its own, so dataset, style
and cycling all keep working underneath it — see `docs/ui-architecture.md`
for the control and why that distinction matters.

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
absent means DTM. Like hybrid it's a modifier rather than a fourth mode; the
control is in `docs/ui-architecture.md`.

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

### Flyfoto (Norge i bilder ortofoto)

Two distinct things, on the same imagery:

1. **A background mode** — "Flyfoto" in ribbon row 1, beside Standard / LiDAR
   / Hybrid, with the same shape of dataset pulldown and W/S cycling. Just
   *looking*, so no licensing notice. Layer plumbing below; the control is in
   `docs/ui-architecture.md` §5.5.
2. **A lokalitet action** — "Flyfoto" in row 2 stitches NiB ortofoto over the
   authored bbox and *keeps* it as an attachment of kind `flyfoto`. Gated by
   the licensing notice, every time.

The old TopBar "Flyfoto ↗" external link is gone — it navigated out of the app
to do worse than what the background mode now does in place.

#### The background mode

Two dynamic branches of `backgroundLayerAtomEffect`, no static entry in
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
`docs/wms-proxy-and-tiles.md`.

#### The lokalitet grab

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
`docs/wms-proxy-and-tiles.md`.

Licensing: NiB imagery is free for private, non-commercial use;
publishing/commercial use is the user's responsibility. A notice dialog gates
every **grab** (`localities.tools.flyfotoNotice*`), by deliberate product
decision — this facilitates personal use, akin to hitting print. Attribution
lives in that prose, not the chrome. Browsing the same imagery as a background
is not a grab and deliberately has no notice.

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

**Infra.** The sidecar routes `/arcgis/*` to NiB's REST base and everything
else to its WMS base; chain is `/arcgis/nib/*` (Caddy) → `/nib-arcgis/*`
(nginx) → `/arcgis/*` (sidecar). Routing and per-endpoint cache lifetimes:
`docs/wms-proxy-and-tiles.md`.

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
The picker, the licensing gate and the batch cap are UI:
`docs/ui-architecture.md`.

### Terrenganalyse (client-side relief from float DEMs)

"Terreng" fetches the **raw float elevation grid** for a rectangle and computes
its own relief visualizations in the browser, instead of restyling Kartverket's
pre-baked hillshade. Rationale and endpoint details: `docs/terrain-analysis.md`.

It has two entrances, and the surface is the same either way: **ribbon row 1**,
over the visible map, with no lokalitet and no account; or **row 2**, over an
open lokalitet's bbox. Reading the ground is not an act of ownership — only
keeping the render is, and saving from row 1 signs you in and turns the
analysed rectangle into a lokalitet.

- Source is hoydedata.no's ArcGIS ImageServers via `exportImage` with
  `renderingRule={"rasterFunction":"None"}` — the service's *other* raster
  function is `skyggerelieff`, i.e. the shaded product the WMS already
  serves. Same-origin at `/arcgis/hoydedata/*` → Caddy → wmscache →
  `hoydedata.no/arcgis/rest/services/*`. Anonymous, no token sidecar.
- The mosaics are the **per-project** `Prosjekt_DTM` / `Prosjekt_DOM` (0.25 m),
  not the national `NHM_*` ones (1 m). Measured, not assumed: the national
  mosaic silently serves DTM10 upsampled wherever NHM never flew (its DTM10
  catalogue rows carry `MINPS: 0`), and across 120 random land points there
  was **no** place with laser data nationally but not per-project. So there is
  no fallback to the national mosaic and there should not be — the only thing
  it could add back is the 10 m data. Full probe and the 2×2:
  `docs/terrain-analysis.md`.
- Target resolution is **probed**, not fixed: one `outStatistics` catalogue
  query per bbox returns `min(OPPLOSNING)` over the acquisitions there (0.25,
  0.5 or 1 m), which also answers "is there any laser data here" before a
  single megabyte moves. `Prosjekt_DOM` defaults to a `Northwest` mosaic
  method, so `dem.ts` states `esriMosaicAttribute` / `lowps` explicitly to
  keep the two models alike.
- `src/terrain/dem.ts` — fetch + a ~120-line float-TIFF reader. Deliberately
  **not** geotiff.js: the endpoint emits exactly one shape (uncompressed,
  single-band, 32-bit float, tiled 128×128) and adding a dependency would
  mean regenerating `package-lock.json`, which the workstation can't do.
  No-coverage arrives as **sparse tiles** (`TileOffsets: 0`), not as a nodata
  value or an error — those pixels become NaN and every operator is
  NaN-aware.
- `src/terrain/shade.ts` — hillshade, multidirectional hillshade, slope,
  local relief model, sky-view factor. Pure functions over a `Dem`, split
  from rendering so the UI can cache the expensive pass while scrubbing the
  cheap one.
- `src/terrain/TerrainPanel.tsx` — the control surface
  (`docs/ui-architecture.md` §10). Takes `bbox` and `locality` as **props**,
  not from an atom: passing the lokalitet's own bbox through is what makes
  "Juster området" refetch the DEM for free. `terrainStandaloneBboxAtom`
  (`src/terrain/atoms.ts`) holds the row-1 rectangle, and the two entrances can
  never be live at once. Output saves as an attachment of the existing
  `extract` kind (with `style` = the visualization), so no PocketBase
  migration was needed.
- `src/terrain/terrainOverlayLayer.ts` — the render goes **on the map**, as a
  georeferenced `ol/layer/Image` (`ImageCanvasSource`, `zIndex: 1`) over the
  background and under the Kulturminner layers, not as a thumbnail in the
  ribbon. Reading relief *against* the heritage record is the whole point, so
  the relief has to be the ground. Imperative and module-level like
  `swapBackgroundLayers` — the pixels change every slider frame and no React
  component needs to see that.

Load-bearing:

- **The multidirectional blend's azimuths are unevenly spaced and weighted.**
  Averaging evenly spaced azimuths at equal weight cancels the directional
  term by symmetry and silently collapses the result to `cos(zenith)·cos(slope)`
  — a slope map with a hillshade's name. The tell is a maximum of exactly
  0.7071 at altitude 45°, i.e. nothing brighter than flat ground.
- **The two `useMemo`s in TerrainPanel are split on purpose.** Sky-view factor
  is ~800 ms on a 600² grid and must never be keyed on azimuth, or dragging
  the slider queues a multi-second recompute per frame.

## Lokaliteter (user content)

The top-level user object is **an area to explore**, not a claim that
something is there — mirroring Riksantikvaren's lokalitet → enkeltminne
hierarchy. A lokalitet is an authored rectangle — framed from the visible map
in one press, resizable afterwards — holding *funn* (individually named and
addressable drawn features) and *bilder* (kept LiDAR extracts, terrain
renders, map screenshots, flyfoto, uploads).

Two rules that hold regardless of what the interface looks like:

- All lokalitet content is behind sign-in, including `public` ones — the read
  rules require `@request.auth.id != ""`. The map itself stays publicly
  browsable.
- `limited` visibility is a placeholder that behaves as `private` until
  groups exist.

The ribbon rows, the funn/bilder sections, the drawing tools and the policy
decisions around them (bbox is authored not derived, only seeded from the
viewport; drawing and extract exist only inside a lokalitet; measure and
terrain analysis stay global) are in `docs/ui-architecture.md`.

Key files (data side):

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
  (useOAuthProviders, useSignIn, useSignOut).
- `pocketbase/pb_migrations/1700000200_localities.js` — current schema.
  `1700000000` adds `users.role`, `1700000100` relaxes it. **Leave the
  filenames alone** — they're recorded in `_migrations`, so renaming one
  makes PB re-run it. Collection ids must not equal any collection name
  (0.23+ rejects that), hence `pbc_localities` / `finds2` /
  `pbc_attachments`.

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
4. Route requests through `wmscache` rather than hitting the origin from the
   browser, and use the same-origin `/wms/<host-slug>/...` prefix as `wmsUrl`
   (recipe in `docs/wms-proxy-and-tiles.md`).
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
   spread it into `allConfiguredBackgroundLayers` in `atoms.ts`. For a WMS or
   ArcGISImage layer, `coverageExtent` is mandatory — see
   `docs/wms-proxy-and-tiles.md`. A layer whose concrete source is chosen at
   runtime (`lidarProject`, `flyfotoProject`) instead gets a dynamic branch in
   `backgroundLayerAtomEffect`, no static entry, and stays out of
   `VALID_STARTUP_LAYERS` — a cold load onto it would render nothing.
3. Give it a control in ribbon row 1 (`src/shell/RibbonGlobalRow.tsx`). There
   is no thumbnail gallery any more: a *mode* is a `ModeButton`, and a choice
   *within* a mode is a `Pulldown` (see `src/shell/lidar/` and
   `src/shell/flyfoto/` for the two worked examples, incl. how a dataset ring
   registers itself for W/S cycling). Decide which of the two it is before
   writing anything — `docs/ui-architecture.md` §5.2 on modes vs modifiers.
4. Add translations under `ribbon.*` in
   `src/locales/{nb,nn,en}/translation.json`.

## Conventions specific to this fork

- Server-only rebuilds. Do not `npm install` / `tsc` / `npm run build`
  locally; the user's host doesn't carry the build toolchain. Print the
  `docker compose ...` commands they should run.
- Keep unused code out. If a helper (retry function, config field) has no
  live caller after a change, delete it — don't leave it in "for later".
- `icon="…"` props are typed against the `MaterialSymbol` union that
  `material-symbols` ships, re-exported from `src/ui/Icon.tsx`. A
  plausible-looking name that isn't in it fails the docker build. How to check
  a name without local `node_modules`: `docs/ui-architecture.md` §11.
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
  `font-family`. Mulish is self-hosted instead: `src/mainApp.tsx` imports the
  four `@fontsource/mulish` weights the kit asks for, and `src/index.css` sets
  the family on `body`. `font-src 'self'` is enough.
- **Dead dependencies**: `maplibre-gl` and `@geoblocks/ol-maplibre-layer`
  (OpenLayers is the map engine and is the right one for WMS + EPSG:25833;
  MapLibre is vector-tile-first and weak on non-Mercator projections), and
  `fast-xml-parser` (all XML goes through native `DOMParser`).

The Caddyfile CSP is narrowed to what the browser actually contacts:
`cache.kartverket.no` (WMTS tiles *and* its GetCapabilities fetch),
`*.geonorge.no`, `*.norgeskart.no` and `hoydedata.no` (the ArcGIS identify
call in `searchApi.ts`). `style-src` is `'self'` — nothing injects a
stylesheet at runtime now that emotion is gone. Inline style *attributes* are
governed by the separate `style-src-attr`, which keeps `'unsafe-inline'`
because React sets positions, sizes and picked colours that way.
