# Terrain analysis — float DEMs, and what to build on them

Notes for the analysis work that goes beyond re-styling Kartverket's
pre-rendered hillshade. Three parts: the elevation-data access this rests on
(verified, don't re-derive), the two bigger builds that are still designs
(server-side visualization, QGIS handoff), and the Norwegian data sources
we're not pulling yet.

Read `wms-proxy-and-tiles.md` first if you're touching how any of this is
proxied — the routing rules there apply unchanged. `analysis-roadmap.md` is
the shorter overview of the same thread, including the tool survey and what
was rejected.

## Why bother: hillshade is the weak visualization

Everything the app renders today is Kartverket's *pre-baked* raster: the WMS
publishes `skyggerelieff`, `helning_prosent` and friends as named layers and
we pick one. That's a single-azimuth hillshade, and its defining flaw is that
it hides every feature running parallel to the sun. A ditch lit end-on is
invisible.

The archaeological-prospection literature settled this a while ago — the
reference is Kokalj & Hesse, *Airborne laser scanning raster data
visualization* (ZRC SAZU, open access). The visualizations that actually work
for earthworks are illumination-independent: sky-view factor, positive and
negative openness, local relief models, and blends of those (VAT). None of
them can be computed from a shaded PNG. They all need the elevation values.

So the unlock is getting float elevation into our hands.

## Elevation data access (verified 2026-09-09)

`hoydedata.no` runs an ArcGIS Server whose ImageServers will hand over the raw
elevation grid, anonymously, no token:

```
GET https://hoydedata.no/arcgis/rest/services/NHM_DTM_TOPOBATHY_25833/ImageServer/exportImage
    ?bbox=262000,6649000,263000,6650000
    &bboxSR=25833&imageSR=25833
    &size=1000,1000
    &format=tiff&pixelType=F32
    &renderingRule={"rasterFunction":"None"}
    &f=image
→ 200 image/tiff, 4.2 MB, 1000×1000, 32-bit float, 1 m/px
```

`renderingRule` matters: the service's other raster function is `skyggerelieff`,
i.e. the same shaded product the WMS serves. `None` is what gets you values.

Facts worth not re-deriving:

- **The services we care about** are `NHM_DTM_TOPOBATHY_25833` (matches the
  app's existing national background and `searchApi.ts`), `NHM_DOM_25833`
  (surface model — the counterpart to `activeLidarModelAtom`'s DOM), and
  `Prosjekt_DTM` / `Prosjekt_DOM` (per-acquisition). `25832` and `25835`
  variants exist for the other UTM zones; we're 25833 throughout.
- **Request-size caps differ.** The national mosaics declare
  `maxImageWidth/Height: 4096`; `Prosjekt_DTM` declares **15000**. A
  lokalitet-sized bbox is one request either way, but tile against 4096 so the
  national path stays correct.
- **The output TIFF is a very narrow subset of the format.** Always
  little-endian, `Compression: 1` (none), `BitsPerSample: 32`,
  `SampleFormat: 3` (IEEE float), `SamplesPerPixel: 1`, `PlanarConfig: 1`,
  and always **tiled at 128×128** — never striped. That's why
  `src/terrain/dem.ts` carries its own ~120-line reader instead of pulling in
  `geotiff.js`: the dependency is ~500 KB to handle a hundred variants this
  endpoint never emits, and adding it would mean regenerating
  `package-lock.json`, which the workstation can't do (`npm ci` in the
  Dockerfile).
- **No-coverage is signalled by sparse tiles, not by a nodata value.** Ask for
  a bbox outside the LiDAR footprint and you still get a structurally valid
  TIFF — 1135 bytes for a 100×100 request — with `TileOffsets: [0]` and
  `TileByteCounts: [0]`. Absent tile, not an error. The `noData` query
  parameter has no observable effect on this endpoint; don't bother passing
  it.
- **Water inside a covered tile reads as exactly `0.0`**, in bulk. Despite
  the TOPOBATHY name, sea areas near shore come back as a flat zero plane
  rather than bathymetry. Harmless for a land lokalitet, but it will flatten
  the histogram of any bbox with a fjord in it, so relief stretches should be
  computed on percentiles rather than min/max.
- **Georeferencing is exactly what you asked for.** `ModelPixelScale` is the
  requested resolution and `ModelTiepoint` maps raster (0,0) to the bbox's
  north-west corner. There's no need to parse the GeoTIFF geo-tags at all —
  the requested bbox *is* the georeferencing.
- **`Prosjekt_DTM` carries `LAS_PROJECT_NAME`**, so per-acquisition selection
  is available the same way per-project ortofoto works. One difference from
  the NiB recipe: its `allowedMosaicMethods` are `ByAttribute,NorthWest,
  LockRaster` — **`esriMosaicNone` is not in the list**, so the `mosaicRule`
  used for flyfoto won't transfer verbatim. Needs a probe before building on
  it.
- **A standards-based alternative exists** if the ArcGIS dependency ever
  bothers us: `wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833` answers
  GetCapabilities. Untested beyond that.

### Proxying

Routed like every other external source — `/arcgis/hoydedata/*` → Caddy →
wmscache → `hoydedata.no/arcgis/rest/services/*`, using the shared cache
include. A DEM for a fixed bbox never changes, so the 180-day lifetime is
right.

`hoydedata.no` is already in the Caddyfile CSP `connect-src` (the ArcGIS
identify call in `searchApi.ts` still goes direct), but the DEM path
deliberately does not rely on that: same-origin gets us the 25 GB disk cache,
and a 4 MB float TIFF is exactly the kind of response that should only be
fetched from the origin once.

## Tier 1 — server-side visualization sidecar (design, not built)

The client can do hillshade, slope, local relief and a serviceable sky-view
factor (see `src/terrain/shade.ts`). What it can't reasonably do is the
composite blends — VAT and e3MSTP need several layers computed at multiple
scales and combined with specific opacity/blend stacks, and the reference
implementation is Python.

Shape, following the `nib-proxy` precedent:

- A small container — `ghcr.io/osgeo/gdal:ubuntu-small` base, plus `rvt-py`
  (Apache-2.0, ZRC SAZU) and `rasterio`. Add `whitebox-tools` (MIT for the
  open core — its "Extension" toolsets are proprietary and must stay out) if
  multiscale topographic position is wanted.
- One endpoint: POST `{ bbox, model, visualization }` → fetch the float DEM
  from the same upstream → compute → return PNG.
- Only reachable from wmscache on the compose network, like nib-proxy. Caddy
  exposes it under a same-origin prefix.
- Results land as attachments with a new `kind` (`analyse`), which needs a
  migration extending the `attachments.kind` enum, `AttachmentKind` in
  `src/api/attachments.ts`, and `KIND_ICON` in `BilderSection.tsx` — the same
  three places `flyfoto` touched.

Visualizations worth exposing, in rough order of value for earthwork
detection: VAT (the archaeology default blend), sky-view factor, negative
openness (ditches), positive openness (banks), local relief model,
multiscale topographic position.

The cost to weigh before building: it's a new always-on service and a new
Python dependency chain, for output that is a static image per bbox. If the
client-side versions turn out to be good enough in practice, this may not
earn its keep — decide after Tier 0 has had some use.

## Tier 2 — QGIS handoff (design, not built)

The point is to stop being the last stop. A user who has found something wants
to run their own processing chain, and QGIS is where that happens.

Deliverable: an "Åpne i QGIS" workspace action producing a zip containing

- a `.qgs` project with the lokalitet's extent and CRS EPSG:25833 preset;
- the app's proxy WMS/WFS layers pre-wired (Kulturminner, topo, LiDAR) — QGIS
  can consume our same-origin proxy paths directly, given the deployment's
  public base URL;
- a GeoPackage of the lokalitet rectangle, its funn, and the kulturminner
  readout;
- the bbox DTM as a GeoTIFF — we already have the bytes.

A `.qgs` is plain XML and writable by hand; a `.qlr` layer-definition file is
the much smaller 80/20 if the full project turns out fiddly. Optionally ship a
`.model3` Processing model that runs an RVT chain on the bundled DTM.

Worth naming in the user-facing docs, since the handoff is only useful if
people know what to install: **Relief Visualization Toolbox** (the one that
matters), **Whitebox for QGIS**, Zoran Čučković's **Terrain Shading** (fast
SVF/openness) and **Visibility Analysis** (viewsheds — intervisibility of
burial mounds is a real question, not a gimmick), and the SAGA/GRASS
providers already bundled with QGIS (`r.local.relief` is Hesse's local relief
model, written for archaeology; `r.geomorphon` is excellent for classifying
landform elements).

Licensing note for the bundle: Kartverket elevation and Riksantikvaren data
are open (NLOD/CC BY). NiB imagery is **not** — it's free for private
non-commercial use only, so ortofoto must not be baked into an exported
bundle without the same notice the Flyfoto action shows.

## Data we're not pulling yet

Ordered by what would most change what a user can conclude.

**NGU marine limit + shoreline displacement.** The standout, and the most
distinctively Norwegian analysis available to us. Coastal Stone Age sites sit
at the contemporary shoreline, and post-glacial isostatic rebound means that
shoreline is now a specific elevation that varies by location. Combine an
isobase-corrected sea level for a target millennium with the DEM we can now
read, and "show me the terraces in this bbox that were beach at 6000 BP"
becomes a computation rather than a guess. This is a genuine predictive
model, and it's the single strongest argument for having float elevation.

**NGU Løsmasser** (`geo.ngu.no/mapserver/LosmasserWMS3`, verified live —
`Losmasser_temakart_sammenstilt` and a stack of sub-layers). Quaternary
deposits. Tells you whether a bump is an anthropogenic mound or a kame, and
whether ground is diggable. Straightforward theme-layer addition — follow the
"Adding another theme layer" recipe in CLAUDE.md.

**Kartverket historiske kart.** Amtskart and rectified Økonomisk kartverk
sheets. ØK in particular carries fornminne symbols surveyed before a lot of
20th-century ploughing, plus pre-consolidation farm boundaries. Complements
the flyfoto time series directly.

**SSR toponyms as indicators.** Nearly free given the place-name search
already exists: filtering for the *haug / borg / hov / ve / vang / ring /
offer / tingst-* families surfaces candidate areas with no new data source at
all. High signal per unit of effort.

**`kart.ra.no/arcgis/rest/services`.** The REST root returns folders
`Andretjenester` and `MABYGIS` with an empty top-level `services[]` — not
probed further. Worth doing: an ArcGIS `/query` would give real attribute
tables where GetFeatureInfo currently gives us scraps, and it's the same
origin we already proxy for the Kulturminner WMS.

**Point clouds, via PDAL.** The one that could reveal genuinely new features
rather than presenting known ones better: under forest canopy the official
DTM's ground classification smooths away low earthworks, and re-deriving
ground from LAZ with a tuned CSF/SMRF filter recovers some of them. But it
needs the async order API on hoydedata, gigabytes of storage per project, and
server-side processing — a much larger build than anything else here.

### Ruled out

- **Automated detection** (`samgeo`/SAM over a local relief model, CNN mound
  detectors). Tempting and mostly MIT-licensed, but without fine-tuning on
  Norwegian material the false-positive rate makes it noise, and a tool that
  cries wolf is worse than no tool for this audience.
- **Potree / COPC in-browser point clouds.** Impressive, unrelated to reading
  terrain against the heritage register.
- **PostGIS.** The "right" answer for spatial queries in general, but a
  lokalitet-scale workspace needs buffers and intersections over a handful of
  features, which Turf.js does client-side without a second database.
