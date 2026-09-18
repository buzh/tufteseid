# Terrain analysis — float DEMs from hoydedata.no

Kartverket's WMS only publishes relief pre-shaded (`skyggerelieff`,
`helning_prosent`), and a single-azimuth hillshade hides every feature running
parallel to the sun. The visualizations that work for earthworks are
illumination-independent and need elevation values, so this module fetches the
raw float grid and computes relief in the browser. Reference: Kokalj & Hesse,
*Airborne laser scanning raster data visualization* (ZRC SAZU, open access);
RVT's `blend.py` / `blend_func.py` is the specification `composeVat` follows.

Where it lives: `src/terrain/dem.ts` (fetch + TIFF reader), `shade.ts`
(operators), `render.ts` (field → canvas, headless-capable),
`src/shell/terrain/` (the control surface, described in
`docs/ui-architecture.md`), `src/figure/specs.ts` (`terrainFigure`).

Terreng is the fifth ground on the ribbon and a read tool throughout: no
account, no lokalitet, nothing written. It is also the one ground the client
computes rather than fetches, so it is the one bounded by a rectangle, and
there are two sources for that rectangle — never both at once:

- **An open lokalitet's bbox**, read off the record rather than copied, so
  resizing the lokalitet refetches the DEM. This is the branch that can keep
  what it renders, through `Behold`.
- **The standalone window** (`src/terrain/window.ts`), framed on the visible
  map when the ground is entered with nothing open, clamped into the same
  50–1000 m band, and drawn on the map by `windowLayer.ts`. It is held, not
  recomputed: the analysis does not follow the map, because a DEM in the band
  is 64 MB and 16 Mpx of arithmetic per visualization and a render that
  followed would refetch all of it on every pan. `Analyser her` on the settings
  strip moves it. Nothing keeps a standalone render — a lokalitet is what
  keeping is for, and opening one under the window takes the rectangle over.

The band is the containment, and it is exact rather than approximate:
`MAX_DEM_PX_PER_SIDE` is derived as `MAX_SIDE_M / FINEST_M_PER_PX`, so a
rectangle inside the band asks for precisely what the grid cap holds and is
never resampled.

## The endpoint

```
GET /arcgis/hoydedata/Prosjekt_DTM/ImageServer/exportImage
    ?bbox=…&bboxSR=25833&imageSR=25833
    &size=1200,1200&format=tiff&pixelType=F32
    &interpolation=RSP_BilinearInterpolation
    &renderingRule={"rasterFunction":"None"}
    &mosaicRule={"mosaicMethod":"esriMosaicAttribute","sortField":"lowps","sortValue":0}
    &f=image
```

- `renderingRule` is load-bearing: the service's other raster function is
  `skyggerelieff`, the shaded product the WMS already serves. `None` returns
  values.
- Same-origin `/arcgis/hoydedata/*` → Caddy → wmscache →
  `hoydedata.no/arcgis/rest/services/*`. Anonymous, no token sidecar unlike
  NiB. Proxy rules and cache lifetime: `docs/wms-proxy-and-tiles.md`.
- `Prosjekt_DOM` defaults to a `Northwest` mosaic method where `Prosjekt_DTM`
  defaults to `ByAttribute` / `lowps`, so `dem.ts` states `esriMosaicAttribute`
  / `lowps` explicitly to make the two models resolve overlaps alike.
  `allowedMosaicMethods` is `ByAttribute,NorthWest,LockRaster` — no
  `esriMosaicNone`, so the NiB flyfoto `mosaicRule` does not transfer.
- `Prosjekt_DTM` carries `LAS_PROJECT_NAME`, so per-acquisition selection is
  available the way per-project ortofoto is. `maxImageWidth/Height` is 15000
  per-project and 4096 national, but `planTiles`' own `MAX_TILE_PX` (2048) is
  what actually bounds a request.
- `returnDistinctValues=true` works here (unlike NiB's ImageServer) but ignores
  `returnGeometry=false` and ships full footprint rings. Use `outStatistics`.
- Untested standards-based alternative, if the ArcGIS dependency ever bites:
  `wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833` answers GetCapabilities.

### The TIFF

One shape, always: little-endian, uncompressed (`Compression: 1`), single band,
32-bit IEEE float (`BitsPerSample: 32`, `SampleFormat: 3`), `PlanarConfig: 1`,
tiled 128×128, never striped — which is why `dem.ts` carries its own ~120-line
reader rather than `geotiff.js`.

- No coverage arrives as sparse tiles, not as a nodata value or an error: a
  bbox outside the footprint returns a valid TIFF with `TileOffsets: 0` /
  `TileByteCounts: 0`. Those pixels become NaN and every operator is NaN-aware.
  The `noData` query parameter has no observable effect.
- Georeferencing is exactly what was requested (`ModelTiepoint` is the bbox's
  north-west corner at the requested pixel size), so the geo-tags go unparsed.
- Water inside a covered tile reads as exactly `0.0` in bulk, even on the mosaic
  named TOPOBATHY. Harmless on land, but it flattens the histogram of any bbox
  with a fjord in it — stretch on percentiles, not min/max.

### Which mosaic, and why there is no fallback

The app fetches the per-project `Prosjekt_DTM` / `Prosjekt_DOM` (0.25 m), never
the national `NHM_DTM_TOPOBATHY_25833` / `NHM_DOM_25833` (1 m, which the LiDAR
background and `searchApi.ts` do use).

The national mosaic is a blend, not a 1 m laser product: its DTM10 rows carry
`MINPS: 0`, so wherever NHM never flew it serves 10 m contour-derived elevation
resampled up to whatever cell size was asked for — HTTP 200, correct
georeferencing, nothing in the response saying so. The per-project catalogue
gives those rows `MINPS: 27`, so below 27 m/px they drop out and an uncovered
pixel comes back as an absent tile. Measured over 120 random land points: 99
had real laser in both, 21 in neither, and none had laser data nationally but
not per-project. So there is no fallback to the national mosaic and there
should not be — the only thing it could add back is the 10 m data. Corollary:
don't trust the catalogue for coverage, trust the pixels; a point can intersect
a LOWPS 1 footprint and still be served DTM10.

### The resolution probe

Before any pixels, one ~200-byte catalogue query against
`.../ImageServer/query`: the envelope, `spatialRel=esriSpatialRelIntersects`,
`where=OPPLOSNING IS NOT NULL`, and `outStatistics` asking for
`min(OPPLOSNING)`. Acquisitions are 0.25, 0.5 or 1 m and asking for 0.25 m over
a 0.5 m project is 4× the pixels for pure interpolation; the same query also
answers "is there any laser data here" before a megabyte moves. Two reply
quirks: the service upper-cases `outStatisticFieldName`, and no-coverage
arrives as one feature with `"BEST": null`, not as an empty `features` array.
The response is under wmscache's 1000-byte store threshold, so `dem.ts`
memoises it in-tab instead.

`MAX_DEM_PX_PER_SIDE` (4000, derived as `MAX_SIDE_M / FINEST_M_PER_PX`) caps
the assembled grid; `planTiles` scales resolution down to fit, and
`Dem.nativeMetresPerPx` records what the acquisition actually publishes so the
plate can say the render was resampled. Inside the band the two are equal by
construction, so the resampled wording is reserved for a rectangle that got
past the clamp.

## The visualizations, and what each plate records

`src/figure/` stamps a provenance plate onto every raster leaving the app and
`terrainFigure` builds the terrain one — a hillshade at 315°/35° and one at
135°/20° disagree about whether there is a mound in the same field, so a render
without its own azimuth cannot be checked by anyone. Everything in the table is
read back out of the record's `meta` at download time, not frozen into the
pixels at render time.

| Visualization | Recorded |
|---|---|
| hillshade | azimuth, altitude, z-factor |
| multidirectional | all six `MULTI_AZIMUTHS` *and* their weights, altitude, z-factor |
| VAT | the whole `VAT_LAYERS` stack (vis, blend mode, opacity, absolute bounds), frozen sun 315°/35°, z-factor 1, horizon radius, `SVF_DIRECTIONS`, absolute stretch |
| sky-view factor | horizon radius, `SVF_DIRECTIONS`, stretch |
| positive openness | horizon radius, `SVF_DIRECTIONS`, stretch |
| negative openness | horizon radius, `SVF_DIRECTIONS`, inverted ramp, stretch |
| local relief model | smoothing radius, diverging ramp symmetric about zero, stretch |
| slope | z-factor, inverted ramp, stretch |

Always, additionally: model (DTM/DOM), source mosaic, EPSG:25833 extent,
geodetic centre, grid resolution; `figure.set.horizonGrid` when the horizon
scan decimated; `figure.set.resampled` with `nativeMetresPerPx` when the
rectangle exceeded `MAX_DEM_PX_PER_SIDE`.

- `MULTI_AZIMUTHS`, `SVF_DIRECTIONS` and `VAT_LAYERS` are exported because they
  are printed; changing one changes what old and new renders mean relative to
  each other. The VAT line is assembled from `VAT_LAYERS`, so the plate and the
  blend cannot drift.
- Slope and negative openness are drawn on a reversed grey ramp and both say
  so — negative openness is high in a depression, so painted straight it would
  put ditches in white while sky-view beside it puts them in black (RVT inverts
  the same two in `normalize_image`).
- VAT's stretches are absolute where every other view's are 2–98 % percentiles,
  and its sun is frozen: two VAT renders are comparable and two sky-view renders
  are not. Wiring the azimuth slider to VAT would break that silently.

## The horizon radius: reach is bought by decimating

The ray walk costs width × height × directions × steps, so `SVF_MAX_RADIUS_PX`
(24) is a fixed budget on steps — which taken one DEM cell at a time is also a
limit in metres: 24 steps of 0.25 m is 6 m, shorter than a burial mound. So
`horizonDecimation` averages the grid down to no coarser than
`HORIZON_MIN_M_PER_PX` (1 m), `computeHorizonFields` scans that and bilinearly
interpolates sky-view and both opennesses back onto the full grid, masked
against the original NaNs. Reach on a 0.25 m DEM goes 6 m → 24 m and the pass
gets factor² cheaper. 1 m is the floor both ways: below it a 0.25 m grid is
largely interpolation (4–5 points/m² acquisitions), above it the surface stops
resolving the features whose horizon is being measured.

- The horizon views are read off a coarser surface than the hillshade beside
  them, which `figure.set.horizonGrid` prints when the factor exceeds 1.
- A requested radius and an effective one can differ: the ceiling is
  `horizonMaxRadiusMetres` — 24 m on any grid at 1 m or finer, 24 × the cell
  size on a coarser one — and a saved spec can be replayed over another
  rectangle. `clampRadius(vis, dem, metres)` in `render.ts` is the single answer
  both the render and the plate go through, and `radiusRange` takes the
  slider's ceiling from it. Skipping it puts "SVF-radius 40 m" on a 24 m render.
- The four views off the scan are one ray walk read four ways (`usesHorizon`),
  the radius clamped through `'svf'` so all four resolve to the same number,
  which is what lets the control surface cache it (`docs/ui-architecture.md`).

## Tier 1 — server-side visualization sidecar (designed, not built)

A container on the `nib-proxy` pattern (`ghcr.io/osgeo/gdal:ubuntu-small` plus
`rvt-py` and `rasterio`, optionally `whitebox-tools` — MIT core only, its
Extension toolsets are proprietary), reachable only from wmscache, one POST
`{bbox, model, visualization}` → PNG, results landing as attachments under a
new `analyse` kind. Verdict: mostly overtaken, since VAT, sky-view and both
opennesses turned out to be one ray walk plus a few lines of arithmetic and
shipped client-side. What is left is the multiscale family (e3MSTP, multiscale
topographic position), which needs DEMs at several resolutions — one always-on
Python service for one visualization family is a thin case.

## Tier 2 — QGIS handoff (designed, not built)

An "Åpne i QGIS" zip: a `.qgs` project at the lokalitet's extent in EPSG:25833
(plain XML, writable by hand; a `.qlr` is the 80/20), the app's proxy WMS/WFS
layers pre-wired, a GeoPackage of the rectangle, its funn and the kulturminner
readout, the bbox DTM as a GeoTIFF, optionally a `.model3` Processing model
running an RVT chain on it. Verdict: cheapest of the tiers and the only one
that scales past what we think to implement. Plugins worth naming to users:
Relief Visualization Toolbox, Whitebox for QGIS, Čučković's Terrain Shading and
Visibility Analysis, and the SAGA/GRASS providers QGIS bundles
(`r.local.relief` is Hesse's LRM, `r.geomorphon` classifies landform elements).

Licensing constraint on any bundle: Kartverket elevation and Riksantikvaren
data are open (NLOD/CC BY), NiB imagery is not — free for private
non-commercial use only — so ortofoto must not be baked into an export without
the notice the Flyfoto action shows.

## Data we're not pulling yet

- **NGU marine limit + shoreline displacement** — isostatic rebound puts the
  contemporary shoreline at a computable elevation per location and millennium.
- **NGU Løsmasser** (`geo.ngu.no/mapserver/LosmasserWMS3`, verified live,
  `Losmasser_temakart_sammenstilt`) — Quaternary deposits; a plain theme-layer
  addition, recipe in `docs/map-layers.md`.
- **Kartverket historiske kart, the ØK sheets** — fornminne symbols surveyed
  before 20th-century ploughing; Amtskartserien already ships as a Kart
  variant, ØK does not.
- **SSR toponyms as indicators** — the *haug / borg / hov / ve / vang / ring /
  offer / tingst-* families, off the place-name search that already exists.
- **`kart.ra.no/arcgis/rest/services`** — unprobed; the REST root returns
  folders `Andretjenester` and `MABYGIS` with an empty top-level `services[]`.
  An ArcGIS `/query` would give attribute tables where GetFeatureInfo gives
  scraps, on an origin we already proxy.
- **Point clouds via PDAL** — re-deriving ground from raw LAZ recovers low
  earthworks the DTM smooths away under canopy; needs the async order API and
  server-side processing.

What has been ruled out, and why, is in `docs/analysis-roadmap.md`.
