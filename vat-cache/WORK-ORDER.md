# Work order — a cached cVAT ground, computed by RVT

## The job

Build the tile set for one cached combined-VAT ground over a named LiDAR
acquisition, and the batch script that makes it. RVT computes the pixels; the
script decides what ground, on what grid, and where the bytes land.

Not in this task: no UI, no layer registration, no locale strings, no change
under `src/`. This produces a tile store and the tool that made it.

## RVT is the renderer, not a reference to port

`rvt.vis` computes the four layers and `rvt.blend_func` blends them. Nothing
here reimplements a visualization, so there is no parity question and no port to
keep in step — the earlier numpy port, `render.py`, survives only as the
sizing study's harness.

`rvt.blend.BlenderCombination` would hold the layer order too, but importing it
pulls `rvt.default` → `rvt.tile` → `osgeo.gdal`, and nothing else here wants
GDAL. `cvat.py` transcribes the fifteen lines of `render_all_images` that walk
the layer list instead, and installs `rvt-py --no-deps` against numpy, scipy and
matplotlib. `scipy` is pinned under 1.15: `rvt.vis` imports
`scipy.ndimage.morphology`, which 1.15 removed.

**The definition is `VAT_Combined.rft.xml`** in `EarthObservation/rvt-arcgis-pro`,
not anything in rvt-py — rvt-py's `default_blender_combinations.json` carries
"Archaeological combined (VAT combined)" with an empty layer list, and its
`blender_VAT.json` is the general stack alone. Parsed out of the template:

| | general | flat |
| --- | --- | --- |
| Hillshade | 315° / 35° | 315° / 15° |
| Slope, luminosity 50 | 0–50° | 0–15° |
| Openness +, overlay 50 | 68–93° | 85–93° |
| Sky-view, multiply 25 | 0.7–1.0 | 0.9–1.0 |
| `max_rad` / `noise_remove` | 10 px / 0 | 20 px / 3-high |

Combined is general over flat, normal, opacity 50. `noise_remove` is not an
inner radius but a level 0–3 that `rvt.vis` reads as r_min = (0, 10, 20, 40) % of
`max_rad`, so flat's inner radius is 8 px and scales with the outer one for free.

**The overlay opacity still does nothing, and that is the picture we want.**
`blend_overlay` writes its result through the `background` array and returns it,
so the following `render_images(top, background, 50)` mixes the openness layer
with itself. Live in 2.2.3. Every published VAT came out of that path, so
running RVT unmodified is the faithful choice, not a bug to work around.

## Decisions

### 1. Radii are RVT's own pixels, at every level

RVT states `max_rad` in pixels; "5 m and 10 m" is only what 10 px and 20 px come
to on the 0.5 m DEM the templates were calibrated against. A pyramid has to
choose which of the two to hold constant, and the choice is the whole design.

**Hold the pixels.** Every level is then literally RVT's combined VAT with
default parameters on that level's grid, the manifest says so in one line, and
no parameter is off-calibration anywhere. Measured over a 500 m patch of the
fixture acquisition, WebP q90 bytes per pixel:

| level | m/px | reach, general / flat | B/px | metre-locked reach | B/px |
| --- | --- | --- | --- | --- | --- |
| RVT calibration | 0.500 | 5.0 / 10.0 m | 0.306 | — | — |
| z15 | 0.661 | 6.6 / 13.2 m | **0.320** | 5.3 / 9.9 m (8/15 px) | 0.329 |
| z14 | 1.322 | 13.2 / 26.4 m | **0.332** | 5.3 / 10.6 m (4/8 px) | 0.380 |
| z13 | 2.645 | 26.4 / 52.9 m | **0.344** | 5.3 / 10.6 m (2/4 px) | 0.432 |
| z12 | 5.289 | 52.9 / 105.8 m | **0.386** | 5.3 / 10.6 m (1/2 px) | 0.503 |

Holding the metres instead costs sampling as the grid coarsens, and the bytes
say what that is: rising entropy per pixel at every step down, which is noise
being encoded, not structure. At z13 a 2 px radius is one cell's height
difference wearing openness' stretch. Side by side the z13 pair settles it — the
pixel-locked tile reads as landscape relief, the metre-locked one as mush.

What this gives up is that the reach changes as you zoom, so the ladder is four
related pictures rather than one picture at four sizes. That is what a
multi-scale relief pyramid is, and it is a different thing from the fault that
excluded `dynamisk_farget_hoyde`: that one had neighbouring tiles *at the same
level* disagreeing, which absolute stretches prevent here.

This reverses `shade.ts`'s reading, which states the radii in metres because "a
horizon angle over a fixed distance is a fact about the ground". That remains
right for the Analyse tab, where the reader is handed one rectangle at one
resolution and the legend names a radius. A pyramid is the case the argument
does not cover.

### 2. Four levels, z15 down to z12

Pixel-locked radii make z12 a real visualization rather than a signed slope, so
the ladder runs to the level the app's overview borrowing would otherwise have
to fake. z15 (0.661 m) is the base: 0.331 m at z16 is finer than any calibration
RVT offers and buys grain rather than ground.

### 3. Each level is its own job

The levels no longer share a computation — different grid, different scan — so
they no longer share a fetch. Each level fetches at its own resolution, tiles,
and finishes, and a level can be re-run alone without touching the others.

This is cheaper in every way except download. It removes the partial-tile state
that made resume hard, and it removes an alignment trap: a block-mean of one
z15 fetch has to start on a block boundary, and an overlap that is not a
multiple of the decimation factor silently shifts the coarse levels off the tile
grid. Nothing decimates now, so nothing can be misaligned.

The extra download is ~5 GB one-off, and it costs no quality: fetching the
fixture site at 0.661 m directly differs from area-averaging our own 0.25 m
fetch by **1.07 cm RMS**, against a DTM carrying ~3 cm of its own noise. The
service resamples at least as well as we would.

### 4. Overlap is 24 px, and it is per level

A horizon ray that walks off the grid reads as nothing there to block the sky,
so an unmargined tile renders a bright frame and the seams show. The reach that
has to be covered is the largest `max_rad`, 20 px, plus the 3×3 gradient window:
24 px carries both with headroom. In pixels, not metres — the radius rule is in
pixels, so the overlap that serves it should scale the same way, and it comes to
16 m at z15 and 127 m at z12 without anyone choosing those numbers.

### 5. Encoding: RGBA WebP q90

Measured on one z15 tile: 0.339 B/px as grey, **0.339 with an opaque alpha
channel** — WebP stores a constant alpha for nothing — and 0.153 where the
footprint only half reaches. So alpha is free on full tiles and a saving on
partial ones, and it is the honest answer for no-data, which would otherwise
paint uncovered ground a real grey. q85 would be 0.274 and q95 0.423.

The caveat to record: a figure plate must not be generated from cached pixels.
`src/figure/` renders from the float field through `paintTerrainField` and
should keep doing that. The manifest's encoding line is what keeps a screenshot
of this ground honest if one ever becomes an attachment.

### 6. Fetch direct, not through wmscache

~22 GB of float TIFF across the four levels would evict most of wmscache's
25 GB LRU for one-shot reads. The batch talks to `hoydedata.no` directly and
writes to its own volume. `exportImage` caps at 15000 px a side, so a work unit
arrives in one call and there is no mosaic to assemble.

## Shape of the tool

`build_tiles.py <project>`, one level at a time, resumable.

1. **Coverage** — `coverage.py`'s footprint union decides which tiles the
   acquisition reaches. Units the footprint misses are never fetched.
2. **Work unit** — an N×N block of tiles of the level being built, default 4,
   so 2096 px and ~18 MB at any level. Units are ordered and each records a
   marker when done, because a unit that legitimately writes no tiles is not the
   same as one that never ran.
3. **Fetch** — `exportImage`, `pixelType=F32`, `renderingRule` `None`,
   mosaicRule pinned to the acquisition, overlap added and cropped after render.
   Retry with backoff; this is the step that will fail overnight.
4. **Render** — `cvat.py`, which is RVT.
5. **Write** — 512 px RGBA WebP on the app's grid
   (`src/map/layers/wmsTileGrid.ts`: origin `[extent[0], extent[3]]` =
   −2500000, 9045984; resolutions 21664 / 2ⁿ), as `<z>/<x>/<y>.webp`. A tile
   with no coverage at all is not written. The store is
   `/site/tufteseid/data/cvat`, bind-mounted read-only at `/var/www/cvat`,
   which is under Caddy's root — so the tiles are already reachable at
   `/cvat/<z>/<x>/<y>.webp` and the eventual layer needs no proxy route, no
   CSP host and no wmscache entry. A tile the footprint never reached answers
   404, which is also what a tile outside the acquisition should answer.
6. **Manifest** — `manifest.json` beside the tiles: acquisition, RVT version,
   both presets, the blend order, azimuth, the combined opacity, and per level
   the resolution, `r_max`/`r_min` in pixels and metres, overlap and encoding —
   plus a digest over all of it. A run against an existing manifest with a
   different digest stops rather than mixing two caches in one directory.

## Acceptance

- `coverage.py` reproduces 1,106 km² for the fixture acquisition, and the
  rasteriser still returns 879.2 km² for the 879.17 km² footprint.
- A pilot run over ~20 km² completes, resumes correctly after a kill, and its
  tiles show no seams at work-unit boundaries.
- Bytes per pixel and seconds per km² from the pilot replace the single-site
  figures in the table above, which are one 500 m patch of rocky ground.
- Changing one preset value produces a manifest that declares itself different
  and refuses to write into the old cache.
- Only then the full run: ~1.5 core-hours of arithmetic, ~22 GB fetched, and on
  the single-site bytes ~1.3 GB written.

## Constraints carried from the repo

- Kartverket elevation is NLOD/CC BY, so caching derived rasters is fine. NiB
  imagery is not, and none of it goes near this.
- When this eventually reaches the UI, the ground's name is de-branded and needs
  `nb`, `nn` and `en`. Not this task.
- Nothing here may become a dependency of the SPA build.
