# Terrain analysis — float DEMs from hoydedata.no

Kartverket's WMS only publishes relief pre-shaded (`skyggerelieff`,
`helning_prosent`), and a single-azimuth hillshade hides every feature running
parallel to the sun. The visualizations that work for earthworks are
illumination-independent and need elevation values, so this module fetches the
raw float grid and computes relief in the browser. Reference: Kokalj & Hesse,
*Airborne laser scanning raster data visualization* (ZRC SAZU, open access);
what `composeVat` follows is RVT's `blend.py` / `blend_func.py` as they run, not
`settings/blender_VAT.json` as it reads — see below for where the two differ.

Where it lives: `src/terrain/dem.ts` (fetch + TIFF reader), `shade.ts`
(operators), `render.ts` (field → canvas), `window.ts`, `windowLayer.ts` and
`windowAdjust.ts` (the rectangle being read, its frame on the map, and placing
it by hand), `terrainLayer.ts` (the finished canvas on the map). The control
surface is `src/terrainControls/`, split between the band's tool section and a
box floating on the map — see below.

Terrain analysis — internal name `terreng` — is a read tool throughout: nothing
is written. It is also the one picture the client computes rather than fetches,
so it is the one bounded by a rectangle, and that rectangle is
`terrainWindowAtom` (`src/terrain/window.ts`): a square, framed on the visible
map when the reader turns the tool on and then placed by hand, and null when
there is no analysis running. Nothing else records the tool being on.
`terrainAdjustingAtom` beside it says whether the square is still being placed,
which is the difference between a rectangle that has cost nothing and one that
has cost a download.

**The square is the largest one that fits inside the visible map, and at most
`MAX_SIDE_M` (500 m) on a side** — `squareBboxWithin` in `src/map/bbox.ts`, over
the inset viewport from `viewportBbox`. Three things are load-bearing there:

- *Square*, because the ceiling is: clamping each axis on its own keeps the
  screen's aspect and hands a reader who asked for the cap a 500 × 280 m
  analysis on a wide window.
- *Inside*, because the square framed on the screen is the one the reader then
  takes hold of, and one that started off the edges is one they cannot reach the
  corners of. `squareBboxWithin` has no minimum side for the same reason — a
  floor is the one rule that could push the square back out past the edge. The
  drag does have one, `MIN_SIDE_M`, because there it is the hand aiming at a
  size and nothing is going to be pushed anywhere.
- *Held, not recomputed*: the analysis does not follow the map, because a DEM at
  the ceiling is 19 MB and 4.8 Mpx of arithmetic per visualization and a render
  that followed would refetch all of it on every pan. `Juster` in the box gives
  the rectangle back; the off switch drops it, and with it the grid.

500 m is also exact rather than approximate. It is a whole number of cells at
every resolution the per-project mosaics publish — 2000 px at 0.25 m, 1000 at
0.5, 500 at 1 — and `MAX_DEM_PX_PER_SIDE` is derived as
`(MAX_SIDE_M + 2 × DEM_MARGIN_M) / FINEST_M_PER_PX`, so a square at the ceiling
asks for precisely what the grid cap holds and is never resampled.

Nothing keeps a render. What the reader's own records turn out to be is an open
question on this branch (`docs/state-of-the-branch.md`), and until there is
somewhere to put one, the analysis is something you look at and then take down.

## The control surface

`src/terrainControls/`, and it has two hosts. They share no props and no
component state: both reach `terrainWindowAtom`, which is the rectangle and the
on switch at once, and `terrainAdjustingAtom`, which says the rectangle is still
being placed.

- **`TerrainToggle`**, in the band's tool section, because whether the client is
  computing relief is true whichever ground is up. One `ControlButton` and
  nothing else — two atom writes, no state. Off is not a blind, as it is on
  Kulturminner: it drops the grid, which is the 19 MB and most of the reason the
  control exists. On downloads nothing: it frames a square and hands it over.
- **`TerrainSurface`**, mounted by `MapComponent`, is the analysis — the
  controller, the DEM, and the box. Mounted once, because a second is a second
  DEM, a second horizon scan and a second canvas over the same ground; mounted
  unconditionally, because the reading it holds in component state
  (visualization, sun, exaggeration, both radii, transparency) has to survive
  taking a render down to look at the ground under it. A component of its own
  rather than a hook call in `MapComponent`, so that an azimuth drag re-renders
  the box and not the panes, the curtain and the heritage card with it.

**The box floats on the map rather than hanging off the band.** Everything in it
changes a picture the reader is looking at while they turn it — a sun moving
across relief, a radius opening a hollow, a transparency letting the ground back
through — and a dropdown that covers the map and closes on the first click makes
each of those a round trip. Top left: the zoom and rotate controls are off, the
right half of a split belongs to the second pane, and the scale line has the
bottom left. It is positioned against the map's own rectangle, so it sits under
the band without being told how tall the band is, and the header folds the rest
away — the box costs a corner of the view, and giving that back must not cost
the grid.

Inside it, in order: one button that is either `Start` or `Juster`, the eight
visualizations as one pulldown grouped lit / blended / unlit with the chosen
one's meaning under it, the height model as the same split `ControlButton` the
LiDAR ground wears in the band, and only the sliders the current visualization
reads — two tracks for sky-view factor, four for a hillshade. The header carries
the state: the side length while the square is being dragged, then `henter
høydedata …`, then the side and the grid resolution, or what went wrong. A DEM
is megabytes over the slowest origin in the stack, so "nothing has appeared yet"
has to be answerable at a glance.

**The rectangle is placed before anything is fetched.** `terrainAdjustingAtom`
is that state: there is a square on the map and no grid under it. It is where
the analysis opens, `Start` is what leaves it, and `Juster` is what returns to
it. The reason is the download — framing the screen and pulling 19 MB in one
press charges a reader for the ground they happened to be looking at, and the
only way back is to pan and press again. Free until `Start`, the square can be
dragged onto the mound and pulled in to the 200 m that actually matters.

`src/terrain/windowAdjust.ts` is the drag: a solid frame with four corner
handles and one `ol/interaction/Pointer`, mounted by the controller and gone
again the moment `Start` is pressed, at which point the dashed
`windowLayer.ts` frame takes over. Inside the square moves it, a corner resizes
it about the opposite corner, and anywhere else is the map's own pan, so the
reader can still navigate while choosing. The square stays square in EPSG:25833
and is clamped to `MIN_SIDE_M`…`MAX_SIDE_M`; the direction of a resize is fixed
when the corner is grabbed, so pulling a hand through the anchor collapses the
square rather than turning it inside out. The drag writes `terrainWindowAtom` on
every frame rather than on release — the atom stays the only copy of the
rectangle, the geometry is redrawn from a `store.sub` and the side length in the
box reads straight out of it, and nothing expensive is listening because
`terrainAdjustingAtom` is holding the fetch off. While it is up, the Kulturminner
hover stands down: that drag owns the cursor and a tip over the ground being
framed answers a question nobody asked.

`Juster` reframes onto the current view only when the rectangle has gone off the
screen entirely. A reader who can still see a corner of it means that rectangle;
one who has panned a valley away means the ground in front of them.

**The radius slider commits on release** for the horizon views and streams for
LRM. `useTerrainControls` memoizes `computeHorizonFields` separately from the lit
pass and keys it on neither `vis` nor the azimuth, which is what makes switching
between sky-view and the two opennesses instant and what keeps a multi-second
recompute off every frame of a drag.

The grid is released in the fetch effect's cleanup, not in a verb. That is what
lets the band's button stop an analysis it holds no state for: every verb here —
on, off, `Start`, `Juster` — is a write to one of the two atoms, and the
controller drops the DEM when the rectangle it belonged to goes away or goes
back to being placed. `terrainAdjustingAtom` is a key on that effect and not
merely a guard inside it, which is what makes `Start` begin the fetch at a
moment when the rectangle itself has not changed.

The render lands on the map through `terrainLayer.ts`: one `ImageLayer` over an
`ImageCanvasSource` fixed to EPSG:25833 at zIndex 1, drawing the canvas
`paintTerrainField` filled. Imperative and module-level, because the pixels
change dozens of times a second and the element they change in does not — the
controller repaints the same canvas, so there is no new identity for React or
Jotai to notice, and `source.changed()` is the only way to invalidate the one
image the source caches. Nearest-neighbour on the way up: smoothing blurs away
the single-pixel step the picture exists to show.

Like the Kulturminner tip and card, it is wired to the main map only — the
right-hand pane of a split draws the ground but no analysis over it.

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

`MAX_DEM_PX_PER_SIDE` (2192, derived as
`(MAX_SIDE_M + 2 × DEM_MARGIN_M) / FINEST_M_PER_PX`) caps the assembled grid;
`planTiles` scales resolution down to fit, and `Dem.nativeMetresPerPx` records
what the acquisition actually publishes so the plate can say the render was
resampled. The cap and the ceiling meet exactly — a 500 m square at 0.25 m is
2192 px with its margin — so no rectangle the control can frame is ever
resampled, and the coarsened wording is reserved for a caller that built a
rectangle some other way.

### The margin

`fetchDem` fetches `DEM_MARGIN_M` (24 m, the longest reach
`horizonMaxRadiusMetres` can ask for) of extra ground on all four sides and
crops it off before anything is painted. Without it the horizon rays along the
edge walk off the grid, which reads as nothing there to block the sky — a
24 m-wide frame around every render, too open, too bright, too convex. RVT pads
the array by `radius_max` with `mode='reflect'`; real neighbouring ground is the
honest version of that.

The `Dem` therefore carries three extents, and mixing them up is the failure
mode: `bbox25833` is the rectangle asked for, `grid25833` is that grown by the
margin and is what `width × height` spans, and `window` is where the rectangle
sits inside the grid in whole pixels. Everything that reaches a reader goes
through `window` — the crop in `paintTerrainField`, the percentile stretches
(a stretch taken over ground the reader cannot see is one they cannot check),
the resolution readout, and `demImageExtent` for placing the canvas on the map.
What is *stored* in an attachment's `meta` is `bbox25833` instead: it is what a
re-render and the duplicate guard compare against, so it has to survive a round
trip unchanged, and the painted window lands within half a pixel of it.

The coverage probe deliberately still runs on the unpadded rectangle. Otherwise
the margin could pull a finer neighbouring acquisition in and resample the whole
grid to a resolution the rectangle itself has no data for, and "no laser data
here" would stop being an answer about the rectangle.

## The visualizations, and what each plate records

A hillshade at 315°/35° and one at 135°/20° disagree about whether there is a
mound in the same field, so a render without its own parameters recorded
alongside cannot be checked by anyone. The old interface stamped a provenance
plate onto every raster leaving the app; that went with the rest of it, and
whatever replaces it owes the same table. These are the parameters that have to
survive a render:

| Visualization | Recorded |
|---|---|
| hillshade | azimuth, altitude, z-factor |
| multidirectional | all six `MULTI_AZIMUTHS` *and* their weights, altitude, z-factor |
| VAT | the `VAT_STACK` layers (vis, blend mode, opacity), both `VAT_PRESETS` in full (sun height, slope, openness and sky-view bounds, inner and outer radius) and the opacity they are combined at, frozen azimuth 315°, z-factor 1, `SVF_DIRECTIONS`, absolute stretch |
| sky-view factor | horizon radius, `SVF_DIRECTIONS`, stretch |
| positive openness | horizon radius, `SVF_DIRECTIONS`, stretch |
| negative openness | horizon radius, `SVF_DIRECTIONS`, inverted ramp, stretch |
| local relief model | smoothing radius, diverging ramp symmetric about zero, stretch |
| slope | z-factor, inverted ramp, stretch |

Always, additionally: model (DTM/DOM), source mosaic, EPSG:25833 extent,
geodetic centre, grid resolution; `figure.set.horizonGrid` when the horizon
scan decimated, or `figure.set.vatGrid` — a separate line because VAT computes
its whole stack there, not only its scan; `figure.set.resampled` with
`nativeMetresPerPx` when the rectangle exceeded `MAX_DEM_PX_PER_SIDE`.

- `MULTI_AZIMUTHS`, `SVF_DIRECTIONS`, `VAT_STACK` and `VAT_PRESETS` are exported
  because they are printed; changing one changes what old and new renders mean
  relative to each other. The VAT lines are assembled from the last two, so the
  plate and the blend cannot drift.
- Slope and negative openness are drawn on a reversed grey ramp and both say
  so — negative openness is high in a depression, so painted straight it would
  put ditches in white while sky-view beside it puts them in black (RVT inverts
  the same two in `normalize_image`).
- VAT's stretches are absolute where every other view's are 2–98 % percentiles,
  and its sun is frozen: two VAT renders are comparable and two sky-view renders
  are not. Wiring the azimuth slider to VAT would break that silently.

## VAT, and why it is two of them

RVT's "VAT — Archaeological" is four layers over one another: hillshade at
100 %, slope at 50 % luminosity, positive openness at 100 % overlay, sky-view
factor at 25 % multiply (`VAT_STACK`). Over single-band data two of the three
blend modes collapse — a luminosity blend is the active layer, and an opacity is
a plain linear mix — so `composeVat` is four lines of arithmetic, and only
overlay keeps its own, driving off the *background* rather than the active layer
as `rvt.blend_func.blend_overlay` does.

The openness layer's 100 % is copied from RVT's behaviour and not from its
settings file, which says 50. `blend_overlay` writes its result into the
background array it was handed and returns that same array, so the caller in
`rvt/blend.py` — `render_images(top, background, opacity)` — mixes the blended
layer with itself and the opacity does nothing. `blend_multiply` and
`blend_screen` allocate, so the sky-view layer's 25 % survives; overlay and soft
light are the two that get eaten. This has been RVT's behaviour since at least
2023, so every published VAT image and every RVT plugin output an archaeologist
has calibrated an eye against came out of that path. Honouring `blender_VAT.json`
instead cost about 40 % of the composite's local contrast, measured across a
ditch floor, a hollow, level ground and a bank crest — and the openness layer is
what makes a low bank visible at all, so the half-strength version read as a
soft hillshade with a wash over it.

What makes it work is the absolute stretches, and what makes a single set of
them fail is gentle ground. RVT ships three terrain parameter sets in
`settings/default_terrains_settings.json` — general, flat and steep — and the
general one assumes relief that Norwegian farmland does not have. Measured on a
synthetic 0.5° hillside at 0.25 m carrying a 12 m gravhaug, a 2 m ditch and a
20 m bank 25 cm high:

| stretches | whole image | ditch | mound | low bank |
|---|---|---|---|---|
| general | 0.52–0.87 (0.35) | 0.34 | 0.21 | 0.018 |
| flat | 0.07–0.83 (0.76) | 0.74 | 0.63 | 0.086 |
| flat, with its own sun and radii | 0.02–0.81 (0.79) | 0.66 | 0.65 | 0.107 |

Under the general numbers the bank moves four grey levels out of 256. Upstream
of the blend, positive openness over that scene spans 81.8–91.1° against a
68–93° stretch and sky-view 0.858–1.000 against 0.7–1, so both horizon layers
run at a third to a half of their intended contrast and VAT collapses towards
hillshade-plus-slope. Those composite figures were measured before the openness
layer went to full strength and before the stack moved onto one grid, so the
spans are now wider than the table says; the gap between the two parameter sets,
which is what the table is here for, is not one the changes touch.

So the ring entry is RVT's *combined* VAT (`VAT_combined.py`): the general stack
at 50 % over the flat one, which is their mean. Neither alone is offered.
General goes flat on gentle ground, flat oversaturates on steep, and a reader
choosing between them is being asked to classify the terrain before looking at
it — which is what they came to the picture to do.

Two details of the presets are restatements rather than copies. RVT gives the
search radii in pixels (10 and 20) against the 0.5 m data it was written for;
`VAT_PRESETS` states them in metres (5 m, and 10 m starting 4 m out), because a
horizon angle over a fixed distance is a fact about the ground while over a
fixed pixel count it is a fact about the grid, and the stretches are calibrated
against the angle. And RVT's `svf_noise` is not a filter but an inner radius —
skip the first 0/10/20/40 % of `r_max` — which `scanHorizon` takes as
`innerMetres`. Only VAT passes one: `computeHorizonFields`, which serves the
three views that offer the reader a radius, starts its rays at the first cell,
because that radius is the one number on the legend and a second hidden one
under it would make that a fiction.

VAT does not share the horizon family's ray walk, its radius slider or its
decimation rule. It imposes its own grid through `vatDecimation`, targeting
`VAT_SCAN_M_PER_PX` (0.5 m, RVT's own calibration resolution) and falling back
to coarser only to stay under a budget of 1.25 M cells, which is about three
seconds for the pair of scans. The budget sits just clear of a `MAX_SIDE_M`
square, 1.20 M cells at the scan resolution, so the ceiling case reads at 0.5 m
and the fallback is a guard rather than something the reader meets. Reading the
same scene at 0.25 m instead bought
5 % more contrast across a ditch and, with 3 cm of noise in the DEM, nearly
doubled the speckle on featureless ground — grain, not signal. `vatDecimation`
takes metres rather than a `Dem` so a figure caption can reach the same answer
from a stored bbox.

All four layers are computed on that grid, not just the two horizon ones, and
only the finished composite is interpolated back to the DEM's own resolution.
RVT reads its whole stack off one surface and the stretches are calibrated
together against it; splitting the difference — gradients at 0.25 m, horizon at
0.5 m — produced a sharp hillshade with a blurred wash over it, and left the
slope layer twice as sensitive to DEM noise as RVT's is. Three centimetres of
noise over a two-cell baseline is 3.4° of slope at 0.25 m against 1.7° at 0.5 m,
and the flat preset's entire slope stretch is 15°. Doing it this way is also
cheaper: the gradient walk now runs over the same 1.2 M cells as the scans
instead of over the 4.8 M a square at the ceiling holds at 0.25 m.

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
- The three views off the scan are one ray walk read three ways (`usesHorizon`),
  the radius clamped through `'svf'` so all three resolve to the same number,
  which is what lets a control surface memoize it across slider moves.
  VAT is not among them: its radii are pinned by its presets the way its sun is,
  so it has neither a slider to answer nor a scan to share.

## Tier 1 — server-side visualization sidecar (designed, not built)

A container on the `nib-proxy` pattern (`ghcr.io/osgeo/gdal:ubuntu-small` plus
`rvt-py` and `rasterio`, optionally `whitebox-tools` — MIT core only, its
Extension toolsets are proprietary), reachable only from wmscache, one POST
`{bbox, model, visualization}` → PNG, results landing as attachments under a
new `analyse` kind. Verdict: mostly overtaken, since sky-view, both opennesses
and VAT on top of them turned out to be a ray walk plus a few lines of
arithmetic and shipped client-side. What is left is the multiscale family (e3MSTP, multiscale
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
