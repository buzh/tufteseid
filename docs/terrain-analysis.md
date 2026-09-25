# Terrain analysis — float DEMs from hoydedata.no

Kartverket's WMS publishes relief only pre-shaded. This module fetches the raw
float grid from hoydedata.no's ImageServer and computes illumination-independent
relief in the browser. Reference: Kokalj & Hesse, *Airborne laser scanning
raster data visualization* (ZRC SAZU); `composeVat` follows RVT's `blend.py` /
`blend_func.py` as they *run* — see [VAT](#vat).

Read-only: nothing here is written or persisted. Internal name `terreng`.

## Modules

| File | What it holds |
| --- | --- |
| `src/terrain/dem.ts` | `fetchDem`, the coverage probe, the tiled-float TIFF reader, the `Dem` type |
| `src/terrain/shade.ts` | every operator, every visualization constant, `composeVat` |
| `src/terrain/render.ts` | field → canvas, ramps and stretches, `clampRadius`, `demImageExtent`, defaults |
| `src/terrain/window.ts` | `terrainWindowAtom`, `terrainAdjustingAtom` and the three write atoms |
| `src/map/rectAdjust.ts` | the placement drag (frame + four corner handles, one `ol/interaction/Pointer`). Shared: a spot's footprint is placed the same way |
| `src/terrain/windowLayer.ts` | the dashed frame once the rectangle is fixed (zIndex 4) |
| `src/terrain/terrainLayer.ts` | `ImageLayer` over `ImageCanvasSource`, EPSG:25833, zIndex 1 |
| `src/terrainControls/` | `TerrainToggle` (band), `TerrainSurface` + `TerrainPanel` (floating box), `useTerrainControls` |

Precomputed VAT served as tiles (`/cvat/*`) is a separate path: `vat-cache/`
and `vat-cache/README.md`, registered in `docs/map-layers.md`.

Two other readers of the same endpoint carry their own copies of the quirks
below, because neither runs in the browser: `vat-cache/fetch_dem.py` and
`rendersvc/dem.py` (`docs/render-sidecar.md`). A fact learned here is learned in
three places; the probe's upper-cased `BEST`, the explicit `mosaicRule` and the
absent-tile NaN are the three that have caught all of them.

## The endpoint

```
GET /arcgis/hoydedata/{Prosjekt_DTM|Prosjekt_DOM}/ImageServer/exportImage
    ?bbox=…&bboxSR=25833&imageSR=25833
    &size=W,H&format=tiff&pixelType=F32
    &interpolation=RSP_BilinearInterpolation
    &renderingRule={"rasterFunction":"None"}
    &mosaicRule={"mosaicMethod":"esriMosaicAttribute","sortField":"lowps","sortValue":0}
    &f=image
```

Same-origin `/arcgis/hoydedata/*` → Caddy → wmscache → `hoydedata.no/arcgis/
rest/services/*`. Anonymous, no token sidecar. Proxy rules:
`docs/wms-proxy-and-tiles.md`.

- `renderingRule: None` is load-bearing — the service's other raster function,
  `skyggerelieff`, returns a shaded image instead of values.
- `mosaicRule` is stated explicitly because `Prosjekt_DOM` defaults to
  `Northwest` while `Prosjekt_DTM` defaults to `ByAttribute` / `lowps`.
  `allowedMosaicMethods` is `ByAttribute,NorthWest,LockRaster` — no
  `esriMosaicNone`, so the NiB flyfoto `mosaicRule` does not transfer.
- `maxImageWidth/Height` is 15000 per-project, 4096 national; `planTiles`'
  `MAX_TILE_PX` (2048, `src/lidarExtract/stitch.ts`) is the real bound.
- `returnDistinctValues=true` works here (unlike NiB's ImageServer) but ignores
  `returnGeometry=false` and ships full footprint rings. Use `outStatistics`.
- `Prosjekt_DTM` carries `LAS_PROJECT_NAME`, so per-acquisition selection is
  available.
- Untested standards-based alternative:
  `wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833` answers GetCapabilities.

### Response TIFF

One shape only, which is why `dem.ts` carries its own ~120-line reader rather
than `geotiff.js`: little-endian, uncompressed (`Compression: 1`), single band,
32-bit IEEE float (`BitsPerSample: 32`, `SampleFormat: 3`), `PlanarConfig: 1`,
tiled 128×128, never striped.

- **No coverage arrives as sparse tiles**, not as a nodata value and not as an
  error: `TileOffsets: 0` / `TileByteCounts: 0` inside an otherwise valid TIFF.
  Those pixels become NaN; every operator is NaN-aware. The `noData` query
  parameter has no observable effect.
- Tiles are padded to full size at the right and bottom edges.
- Georeferencing is exactly what was requested (`ModelTiepoint` = the bbox's
  north-west corner at the requested pixel size), so the geo-tags go unparsed.
- **Water reads as exactly `0.0` in bulk**, even on the mosaic named
  TOPOBATHY. Stretch on percentiles, not min/max.
- An all-errored fetch must not surface as "no LiDAR here": `fetchDem` throws
  when every tile failed, and returns `null` only for real absence.

### Mosaic choice — no fallback to the national one

The app uses per-project `Prosjekt_DTM` / `Prosjekt_DOM` (down to 0.25 m), never
national `NHM_DTM_25833` / `NHM_DOM_25833` (1 m, which the LiDAR background does
use).

The national mosaic is a blend: its DTM10 rows carry `MINPS: 0`, so where NHM
never flew it silently serves 10 m contour-derived elevation upsampled — HTTP
200, correct georeferencing, nothing in the response saying so. The per-project
catalogue gives those rows `MINPS: 27`, so below 27 m/px they drop out and an
uncovered pixel comes back as an absent tile. Over 120 random land points, no
point had laser nationally but not per-project. Corollary: **don't trust the
catalogue for coverage, trust the pixels** — a point can intersect a LOWPS 1
footprint and still be served DTM10.

### Resolution probe

`probeCoverage` runs one ~200-byte query against `…/ImageServer/query` before
any pixels: the envelope, `spatialRel=esriSpatialRelIntersects`,
`where=OPPLOSNING IS NOT NULL`, `outStatistics` asking `min(OPPLOSNING)` as
`best`. It answers both "what resolution" and "is there any laser data here".

- The service **upper-cases** `outStatisticFieldName` — read `BEST` (with
  `best` as fallback).
- No coverage arrives as **one feature with `"BEST": null`**, not as an empty
  `features` array.
- Result is under wmscache's 1000-byte store threshold, so `dem.ts` memoises it
  in-tab (`coverageCache`); a failed probe is `'unknown'`, distinct from
  `'none'`, and is evicted.
- Probed on the bare rectangle, fetched on rectangle + margin: otherwise the
  margin can pull in a finer neighbouring acquisition and resample the whole
  grid to a resolution the rectangle itself has no data for.

### The margin and the three extents

`fetchDem` requests `DEM_MARGIN_M` (24 m — the longest reach
`horizonMaxRadiusMetres` can ask for) of extra ground on all four sides, so
horizon rays near the edge do not walk off the grid and paint a bright convex
frame. It is cropped off before anything is painted.

| `Dem` field | Meaning |
| --- | --- |
| `bbox25833` | the rectangle asked for |
| `grid25833` | `bbox25833` grown by the margin; what `width × height` spans |
| `window` | where `bbox25833` sits inside the grid, in whole pixels |

Everything reaching a reader goes through `window`: the crop in
`paintTerrainField`, the percentile stretches, the resolution readout, and
`demImageExtent`. The painted window lands within half a pixel of `bbox25833`.

## Sizing constants

| Constant | Value | Where |
| --- | --- | --- |
| `MAX_SIDE_M` | 500 | `src/map/bbox.ts` |
| `MIN_SIDE_M` | 50 (drag floor only; `squareBboxWithin` has none) | `src/map/bbox.ts` |
| `DEM_MARGIN_M` | 24 | `dem.ts` |
| `FINEST_M_PER_PX` | 0.25 | `dem.ts` |
| `MAX_DEM_PX_PER_SIDE` | 2192, `= (MAX_SIDE_M + 2 × DEM_MARGIN_M) / FINEST_M_PER_PX` | `dem.ts` |
| `MAX_TILE_PX` | 2048 | `lidarExtract/stitch.ts` |
| `MAX_CONCURRENT` / `TILE_RETRIES` | 3 / 3 | `dem.ts` |
| `CATALOGUE_TIMEOUT_MS` / `TILE_TIMEOUT_MS` | 20 000 / 60 000 | `dem.ts` |

500 m is exact, not approximate: a whole number of cells at every published
resolution (2000 px at 0.25 m, 1000 at 0.5, 500 at 1), and the cap and the grid
ceiling meet exactly, so no rectangle the control can frame is ever resampled.
`planTiles` scales resolution down when a caller exceeds the cap;
`Dem.nativeMetresPerPx` records what the acquisition publishes, and the panel
switches to `terrainControls.resolutionCapped` when `metresPerPx` exceeds it by
more than 5 %.

At the ceiling the grid is ~19 MB and 4.8 Mpx of arithmetic per visualization.

## Visualizations

`Visualization` union in `shade.ts`; grouped in the panel as lit / blended /
unlit (`VIS_GROUPS` in `TerrainPanel.tsx`).

| Key | What it is | Ramp and stretch (`render.ts`) |
| --- | --- | --- |
| `hillshade` | Horn 3×3 gradients, one sun; azimuth is where light comes *from* | grey, 0..1 |
| `multiHillshade` | six weighted azimuths over one gradient pass (`MULTI_AZIMUTHS`) | grey, 0..1 |
| `vat` | RVT's combined VAT: four blended layers, two presets averaged | grey, **absolute** 0..1, no stretch |
| `svf` | sky-view factor (Zakšek, Oštir & Kokalj 2011), 0..1 | grey, 2–98 % |
| `openPos` | Yokoyama positive openness, degrees; banks and mounds run high | grey, 2–98 % |
| `openNeg` | Yokoyama negative openness, degrees; runs high in hollows | grey **inverted**, 2–98 % |
| `lrm` | Hesse local relief model: DEM minus a 3-pass NaN-aware box blur, signed metres | diverging (brown → near-white → blue-green), symmetric about zero |
| `slope` | Horn gradients → radians | grey **inverted**, 0 to p98 |

Defaults (`render.ts`): `DEFAULT_AZIMUTH` 315, `DEFAULT_ALTITUDE` 35,
`DEFAULT_Z_FACTOR` 2, `DEFAULT_LRM_RADIUS` 15 m, `DEFAULT_SVF_RADIUS` 20 m.
Radius ranges: horizon views 2 m … `horizonMaxRadiusMetres`, LRM 5–60 m step 5,
others none (`radiusRange`).

No-data pixels are written fully transparent, so a coverage edge reads as a hole
rather than as black ground. That is the browser's convention and not a
universal one: the sun loop is a `yuv420p` WebM with no alpha channel, so the
sidecar paints absence mid grey and gates the whole render on how much of the
square had data (`docs/render-sidecar.md`).

## Constraints that look like bugs

- **`MULTI_AZIMUTHS` spans three quadrants, not the full circle.** Six azimuths
  225…90 weighted 3/4/5/4/3/2, peaking at 315°. Equal weights around the whole
  circle cancel the directional term and collapse the blend to a slope map.
- **`SVF_MAX_RADIUS_PX` (24) is a budget on *steps*, not metres.** Reach is
  bought by decimating: `horizonDecimation` averages down to no coarser than
  `HORIZON_MIN_M_PER_PX` (1 m), scans, then bilinearly interpolates back masked
  against the original NaNs. 1 m is the floor both ways — below it a 0.25 m grid
  is mostly interpolation at 4–5 points/m², above it the surface stops resolving
  the features being measured. Requested and effective radius can differ;
  everything that renders or captions a render goes through `clampRadius`.
- **Decimation is a block mean, not a subsample** — point-sampling a 0.25 m DTM
  feeds the scan that grid's interpolation noise as relief.
- **`svf`, `openPos` and `openNeg` are one ray walk read three ways**
  (`usesHorizon`), radius clamped through `'svf'` so all three resolve to the
  same number, which is what lets `useTerrainControls` memoise the scan across a
  visualization switch. VAT is not among them.
- **Horizon rays start at the first cell** (`innerMetres: 0`) for those three,
  because the radius on the legend is the whole of the reading. Only VAT passes
  an inner radius.
- **A direction with no readable cell reads as a flat horizon**, not as NaN;
  sky-view floors the horizon angle at level ground, openness must not.
- **Slope and negative openness are painted on a reversed grey ramp.** Negative
  openness is high in a depression; straight, it would put ditches in white
  while sky-view beside it puts them in black. RVT inverts the same two.
- **Nearest-neighbour when the render is scaled up** (`terrainLayer.ts`) —
  smoothing blurs away the single-pixel step the picture exists to show.

## VAT

RVT "VAT — Archaeological": four layers, `VAT_STACK` in `shade.ts`.

| Layer | Blend | Opacity |
| --- | --- | --- |
| `hillshade` | normal | 100 |
| `slope` | luminosity | 50 |
| `openPos` | overlay | 100 |
| `svf` | multiply | 25 |

Over single-band data a luminosity blend is the active layer and an opacity is a
linear mix, so `composeVat` is four lines; only `overlay` keeps its own
arithmetic, driving off the **background** as `rvt.blend_func.blend_overlay`
does.

- **Openness at 100 % is deliberate**, against `blender_VAT.json` which says 50.
  RVT's `blend_overlay` writes into the background array it was handed and
  returns it, so the caller's opacity mix is a no-op for overlay; `multiply`
  allocates, so sky-view's 25 % does apply. Every published VAT image came out
  of that path. Do not "correct" this to the settings file.
- `VAT_STACK` is data for a legend to print; the compositor does not read it, so
  the two must be kept in step by hand.
- **Two presets, averaged** (`VAT_PRESETS`, `VAT_GENERAL_OPACITY` 0.5) — RVT's
  `VAT_combined.py`. Neither is offered alone: `general` goes flat on Norwegian
  farmland, `flat` oversaturates on steep ground.

| Preset | sunAltitude | slopeMax | openness min/max | svfMin | radius / inner |
| --- | --- | --- | --- | --- | --- |
| `general` | 35° | 50° | 68 / 93° | 0.7 | 5 m / 0 |
| `flat` | 15° | 15° | 85 / 93° | 0.9 | 10 m / 4 m |

- Radii are stated in **metres**, where RVT states pixels (10 and 20) against
  0.5 m data — the stretches are calibrated against a horizon angle over a fixed
  distance. RVT's `svf_noise` is not a filter but an inner radius, taken as
  `innerMetres`.
- **Sun and exaggeration are frozen**: `VAT_AZIMUTH` 315, `VAT_Z_FACTOR` 1
  (against the app's z-factor 2 default), stretches absolute. Two VAT renders
  are comparable; two sky-view renders are not. Wiring the azimuth slider to VAT
  would break that silently.
- **All four layers are computed on one grid** at `VAT_SCAN_M_PER_PX` (0.5 m,
  RVT's calibration resolution) via `vatDecimation`, and only the finished
  composite is interpolated back. Mixing resolutions between layers breaks the
  stretches — 3 cm of DEM noise over a two-cell baseline is 3.4° of slope at
  0.25 m against 1.7° at 0.5 m, and `flat`'s whole slope stretch is 15°.
- `VAT_MAX_SCAN_CELLS` (1 250 000, ~3 s for the two scans) is a fallback guard,
  set just clear of a `MAX_SIDE_M` square with its margin (1.20 M cells at
  0.5 m), so the ceiling case still reads at 0.5 m.
- `vatDecimation` takes metres rather than a `Dem`, so a caption can reach the
  same answer from a stored bbox.

## The window and the control surface

`terrainWindowAtom` (a `Bbox`, null = analysis off) and `terrainAdjustingAtom`
(the square is being placed, so nothing has been fetched) are the whole state.
Every verb — on, off, `Start`, `Juster` — is a write to one of them.

- `openTerrainWindowAtom` frames `squareBboxWithin(viewportBbox(map))`: the
  largest square fitting inside the visible map, at most `MAX_SIDE_M`, and sets
  adjusting. Square because clamping axes separately would hand a wide window a
  500 × 280 m analysis; inside, because a square off the edges has corners the
  reader cannot grab.
- `adjustTerrainWindowAtom` (`Juster`) reframes onto the current view **only**
  when the rectangle no longer overlaps it (`bboxOverlaps`).
- `closeTerrainWindowAtom` drops both.
- The analysis does **not** follow the map — the grid is held, not refetched on
  pan.
- The drag (`map/rectAdjust.ts`) stays square in EPSG:25833, clamps to
  `MIN_SIDE_M`…`MAX_SIDE_M`, fixes the resize direction when a corner is
  grabbed, and writes the atom on every frame; the fetch is held off by
  `terrainAdjustingAtom`, which is a **key** on the fetch effect, not a guard
  inside it, so `Start` begins a fetch without the rectangle changing. The
  Kulturminner hover stands down while it is up.
- The grid is released in that effect's cleanup, which is what lets the band's
  stateless `TerrainToggle` stop an analysis.
- `TerrainSurface` is mounted once and unconditionally by `MapComponent`, so the
  reading (visualization, sun, exaggeration, radii, transparency) survives
  taking a render down.
- The radius slider is `deferred` (commits on release) for the horizon views and
  streams for LRM; `useTerrainControls` memoises `computeHorizonFields`
  separately from the lit pass and keys it on neither `vis` nor azimuth.
- The render is wired to the main map only — the right-hand pane of a split
  draws ground but no analysis.
- While an analysis has something to show, `useTerrainControls` publishes its
  settings to `terrainOfferAtom` (`src/evidence/offer.ts`), which is what lets a
  spot keep the same reading over its own footprint. While it stands it is what
  the spot card's camera keeps, ahead of the ground's own offer: the analysis is
  drawn over that ground, so it is what the reader is looking at. The offer
  carries the *clamped* radius, because that is the distance the reading on
  screen was made at. Unlike the ground's offer it cannot be derived — these are
  component state.
