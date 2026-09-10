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
GET https://hoydedata.no/arcgis/rest/services/Prosjekt_DTM/ImageServer/exportImage
    ?bbox=262000,6649000,262300,6649300
    &bboxSR=25833&imageSR=25833
    &size=1200,1200
    &format=tiff&pixelType=F32
    &renderingRule={"rasterFunction":"None"}
    &mosaicRule={"mosaicMethod":"esriMosaicAttribute","sortField":"lowps","sortValue":0}
    &f=image
→ 200 image/tiff, 6.4 MB, 1200×1200, 32-bit float, 0.25 m/px
```

`renderingRule` matters: the service's other raster function is `skyggerelieff`,
i.e. the same shaded product the WMS serves. `None` is what gets you values.

Facts worth not re-deriving:

- **The services we care about** are `Prosjekt_DTM` / `Prosjekt_DOM`
  (per-acquisition, 0.25 m — what `src/terrain/dem.ts` fetches) and the
  national `NHM_DTM_TOPOBATHY_25833` / `NHM_DOM_25833` (1 m — what the app's
  LiDAR background and `searchApi.ts` use). `25832` and `25835` variants exist
  for the other UTM zones; we're 25833 throughout. Why the per-project pair
  won: the coverage probe below.
- **Request-size caps differ.** The national mosaics declare
  `maxImageWidth/Height: 4096`; `Prosjekt_DTM` declares **15000**. A
  lokalitet-sized bbox is one request either way, and `planTiles`' own
  `MAX_TILE_PX` (2048) is what actually bounds a single request — but tile
  against 4096 if the national path is ever used again.
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
- **Water inside a covered tile reads as exactly `0.0`**, in bulk — a flat
  zero plane rather than bathymetry, even on the mosaic named TOPOBATHY.
  (Open water past the laser's reach is not covered at all: at 1 m/px a bbox
  out in Skagerrak comes back fully sparse from national and per-project
  alike, so the bathymetry rows must sit behind a `MINPS` of their own.)
  Harmless for a land lokalitet, but it will flatten the histogram of any
  bbox with a fjord in it, so relief stretches should be computed on
  percentiles rather than min/max.
- **Georeferencing is exactly what you asked for.** `ModelPixelScale` is the
  requested resolution and `ModelTiepoint` maps raster (0,0) to the bbox's
  north-west corner. There's no need to parse the GeoTIFF geo-tags at all —
  the requested bbox *is* the georeferencing.
- **`Prosjekt_DTM` carries `LAS_PROJECT_NAME`**, so per-acquisition selection
  is available the same way per-project ortofoto works. One difference from
  the NiB recipe: its `allowedMosaicMethods` are `ByAttribute,NorthWest,
  LockRaster` — **`esriMosaicNone` is not in the list**, so the `mosaicRule`
  used for flyfoto won't transfer verbatim.
- **A standards-based alternative exists** if the ArcGIS dependency ever
  bothers us: `wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833` answers
  GetCapabilities. Untested beyond that.

### Which mosaic: the coverage-edge probe (measured 2026-09-10)

The analysis originally pinned the **national** 1 m mosaic. It now uses the
**per-project** 0.25 m one, and the switch turned out to cost nothing. What
the measurements said:

- **The national mosaic is not a 1 m LiDAR product — it is a blend.** Its
  catalogue holds NHM laser tiles (`33-158-182`, LOWPS 1, ZORDER −300), DTM10
  tiles (`7607_1_10m_z33`, LOWPS 10, ZORDER −200) and DTM50, and the DTM10
  rows carry **`MINPS: 0`**. There is no lower cell size at which they stop
  participating, so wherever NHM never flew, `exportImage` serves 10 m
  contour-derived elevation resampled up to whatever you asked for. HTTP 200,
  correct georeferencing, no flag anywhere in the response. This is the real
  cause of "the analysis looks softer than the pre-rendered hillshade".
- **The per-project mosaic is honest about the same gaps.** Its DTM10 rows
  carry **`MINPS: 27`**, so below 27 m/px they drop out and an uncovered pixel
  comes back as an absent tile → NaN, which `fetchDem` already handles.
- **Coverage is identical where it matters.** 120 random land points, 128 m
  window at 1 m/px, comparing three fetches per point — national default,
  national restricted to `LOWPS>=10`, and per-project:

  | | per-project has data | per-project empty |
  |---|---|---|
  | **national serves real 1 m** | 99 | **0** |
  | **national serves DTM10** (pixel-identical to its own `LOWPS>=10` mosaic) | 0 | 21 |

  Not one point had laser data nationally and not per-project. So the switch
  loses no LiDAR anywhere; in the ~18 % of land where the national mosaic was
  answering with DTM10, the tool now says "ingen laserdata" instead of drawing
  a smooth lie. **Don't add a fallback to the national mosaic** — the only
  thing it could contribute is exactly that 10 m data.
- **Do not trust the catalogue for coverage; trust the pixels.** A point can
  intersect a LOWPS 1 tile's footprint and still be served DTM10 — those tiles
  are large and internally sparse. The `LOWPS>=10` comparison fetch is the
  reliable detector.
- **`Prosjekt_DOM` defaults to `Northwest`** (`sortField` empty), unlike
  `Prosjekt_DTM`'s `ByAttribute` / `lowps`. `dem.ts` therefore sends an
  explicit `mosaicRule` — `{"mosaicMethod":"esriMosaicAttribute",
  "sortField":"lowps","sortValue":0}` — so both models resolve overlaps to the
  finest raster.
- **Resolution is probed, not assumed.** Acquisitions are 0.25, 0.5 or 1 m;
  requesting 0.25 m over a 0.5 m project is 4× the pixels and 4× the sky-view
  factor for pure interpolation. One catalogue query answers it:

  ```
  GET .../Prosjekt_DTM/ImageServer/query
      ?geometry={envelope}&geometryType=esriGeometryEnvelope&inSR=25833
      &spatialRel=esriSpatialRelIntersects
      &where=OPPLOSNING IS NOT NULL
      &outStatistics=[{"statisticType":"min","onStatisticField":"OPPLOSNING",
                       "outStatisticFieldName":"best"}]
      &returnGeometry=false&f=json
  → {"features":[{"attributes":{"BEST":0.25}}]}
  ```

  Sampled over 45 land points: 0.25 m at 19, 0.5 m at 18, no coverage at 8.
  Two quirks: the reply **upper-cases** `outStatisticFieldName`, and
  no-coverage arrives as one feature with `"BEST": null`, *not* as an empty
  `features` array. The same query doubles as the cheap "is there anything
  here" check, before any megabytes move. It is ~200 bytes, which is under
  wmscache's 1000-byte store threshold, so `dem.ts` memoises it in-tab
  instead.
- **The cost of the switch is pixels.** `MAX_DEM_PX_PER_SIDE` is unchanged at
  3000, so nothing comes back coarser than before — but a small rectangle that
  used to be 300² at 1 m is now 1200² at 0.25 m, i.e. 16× the download and 16×
  the neighbourhood work. That is the trade being bought, and it is why the
  panel prints both the effective and the source resolution.
- **`returnDistinctValues=true` does work here** — unlike on NiB's ImageServer,
  where it silently returns zero features — but it **ignores
  `returnGeometry=false`** and ships full footprint rings with every distinct
  value, which is kilobytes to megabytes for the same one number.
  `outStatistics` is the one to use.

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

### Every saved render carries its own parameters

A render is only as useful as the settings behind it: a hillshade at 315°/35°
and one at 135°/20° disagree about whether there is a mound in the same field,
and a slope map stretched 2–98 % is a different picture from one stretched to
its true range. So nothing leaves the app bare — `src/figure/` draws a caption
panel under every kept or downloaded raster, and `terrainFigure`
(`src/figure/specs.ts`) is the builder that turns the current knob positions
into that caption:

| Visualization | Recorded |
|---|---|
| hillshade | azimuth, altitude, z-factor |
| multidirectional | all six azimuths *and* their weights, altitude, z-factor |
| slope | z-factor, 2–98 % stretch |
| local relief model | radius (`DEFAULT_LRM_RADIUS`), diverging ramp symmetric about zero, stretch |
| sky-view factor | radius (`DEFAULT_SVF_RADIUS`), `SVF_DIRECTIONS`, stretch |

Plus, always: the model (DTM/DOM), the source mosaic, the EPSG:25833 extent,
the geodetic centre, the grid resolution — and, when the rectangle was too
large for `MAX_DEM_PX_PER_SIDE`, the `nativeMetresPerPx` it was resampled
*from*. That last one is the difference between "this is all the detail there
is" and "there is more, ask for a smaller area", and two renders of
different-sized areas are not comparable without it.

Practical consequence for this module: **`MULTI_AZIMUTHS`, `SVF_DIRECTIONS`,
`DEFAULT_LRM_RADIUS` and `DEFAULT_SVF_RADIUS` are exported and printed on
figures.** Changing one silently changes what old and new renders mean relative
to each other; the caption is what keeps that honest, so keep them exported.
The figure machinery itself is `docs/ui-architecture.md` §8.10.

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
