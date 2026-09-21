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
| z16 | 0.331 | 3.3 / 6.6 m | **0.288** | 5.0 / 9.9 m (15/30 px) | 0.282 |
| z15 | 0.661 | 6.6 / 13.2 m | **0.320** | 5.3 / 9.9 m (8/15 px) | 0.329 |
| z14 | 1.322 | 13.2 / 26.4 m | **0.332** | 5.3 / 10.6 m (4/8 px) | 0.380 |
| z13 | 2.645 | 26.4 / 52.9 m | **0.344** | 5.3 / 10.6 m (2/4 px) | 0.432 |
| z12 | 5.289 | 52.9 / 105.8 m | **0.386** | 5.3 / 10.6 m (1/2 px) | 0.503 |

Holding the metres instead costs sampling as the grid coarsens, and the bytes
say what that is: rising entropy per pixel at every step down, which is noise
being encoded, not structure. At z13 a 2 px radius is one cell's height
difference wearing openness' stretch. Side by side the z13 pair settles it — the
pixel-locked tile reads as landscape relief, the metre-locked one as mush.

z16 is the one level where the two rules do not diverge, because there is no
sampling to lose: 15/30 px on a 0.331 m grid is the calibrated reach and both
come out around 0.285 B/px. The pixel rule is kept there anyway, so that one
sentence describes every level of the ladder.

The columns are a comparison of two rules on one rocky patch, not a budget. That
patch runs dear: the z15 pilot came out at 0.280 B/px on fully covered tiles
against the 0.320 above. §5 has the measured bytes.

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

### 2. The ladder ends where the DTM does: z16 down to z12

Pixel-locked radii make z12 a real visualization rather than a signed slope, so
the ladder runs to the level the app's overview borrowing would otherwise have
to fake. The base is not a fixed level but a property of the flight: build down
to the last level whose pixel is no finer than the DEM's own cell, and no
further. Kartverket publishes three cell sizes and they track point density, so
in practice that is **z16 (0.331 m) on a 0.25 m DTM, z15 (0.661 m) on a 0.5 m
one, z14 on 1 m**. Below the cell the service resamples one height value into
four pixels and RVT reads the interpolation as terrain, which is the fault this
rule exists to prevent. `levels_for` in `build_tiles.py` is the rule.

Levels *are* asked for by hand — `-z`, since §3 makes each one an independent
job and a pilot or a rebuild wants one at a time — but only downwards. The rule
is checked against what was asked rather than replaced by it, so naming a level
can build less of a ladder and never a level the flight does not hold.

That 0.25 m grid is finer than the 0.5 m the VAT templates were calibrated
against, and the measurement says to use it anyway. On `compare.py`'s two sites
at q90, **z16 costs 0.288 and 0.324 B/px against z15's 0.320 and 0.364** — bytes
per pixel *falling* as the grid halves, which is the signature of structure
being resolved rather than noise being encoded. It is the exact opposite of what
the metre-locked column in §1 does (0.329 → 0.503 as its sampling degrades), and
it is what settles the question: at z16 tracks, ditches and low mounds separate
that z15 renders as one smear. Per km² it is dearer, because there are four
times the pixels; §5 prices the store.

This reverses the original ruling, which held z15 as the base on the grounds
that 0.331 m is off-calibration and "buys grain rather than ground". Off
calibration it is, and §1 already accepts that at the other four levels for the
same reason: RVT's parameters are in pixels, so every level of a pyramid is a
different reach and none of them is the template's own. Grain it is not.

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

The z15 pilot bears both out over 40 work units: 348 tiles, 17.3 MB, 73 % of the
written area covered. **0.280 B/px on the 175 fully covered tiles**, 0.259 over
covered ground across all of them — so the partial tiles cost 0.215 per covered
pixel, less than the full ones. The edge of an acquisition is cheap, not dear,
and the whole of z15 comes to **0.66 GB** over the 1 106 km² fixture.

z16 quadruples the pixels at 0.91 of the bytes each (§2), so it is **~3.6× the
z15 level on its own** — ~2.4 GB over the same ground, and the largest single
line in the budget.

The caveat to record: a figure plate must not be generated from cached pixels.
`src/figure/` renders from the float field through `paintTerrainField` and
should keep doing that. The manifest's encoding line is what keeps a screenshot
of this ground honest if one ever becomes an attachment.

### 6. Fetch direct, not through wmscache

~90 GB of float TIFF across the ladder would evict wmscache's whole 25 GB LRU
several times over for one-shot reads. The batch talks to `hoydedata.no` directly and
writes to its own volume. `exportImage` caps at 15000 px a side, so a work unit
arrives in one call and there is no mosaic to assemble.

## Shape of the tool

`vatcache.py --get <n>`, one level at a time, resumable.

1. **Coverage** — `coverage.py`'s footprint union decides which tiles the
   acquisition reaches. Units the footprint misses are never fetched. The mask
   is derived from the acquisition on first use rather than named separately:
   pairing one acquisition's footprint with another's DEM was the only mistake
   here that produced no error, just an empty store.
2. **Work unit** — an N×N block of tiles of the level being built, default 4,
   so 2096 px and ~18 MB at any level. Units are ordered and each records itself
   when done, because a unit that legitimately writes no tiles is not the same
   as one that never ran.
3. **Fetch** — `exportImage`, `pixelType=F32`, `renderingRule` `None`,
   mosaicRule pinned to the acquisition, overlap added and cropped after render.
   Retry with backoff; this is the step that will fail overnight.
4. **Render** — `cvat.py`, which is RVT.
5. **Write** — 512 px RGBA WebP on the app's grid
   (`src/map/layers/wmsTileGrid.ts`: origin `[extent[0], extent[3]]` =
   −2500000, 9045984; resolutions 21664 / 2ⁿ), as
   rows of `<acquisition-slug>.mbtiles`, one database per acquisition, because
   overlapping flights are wanted — two readings of one landscape, offered as
   two rows — and one namespace would have them overwrite each other. A tile
   with no coverage at all is not written. The store is
   `/site/tufteseid/data/cvat`, bind-mounted read-only into the `cvat-tiles`
   sidecar, which answers `/cvat/<slug>/<z>/<x>/<y>.webp` with one indexed
   SELECT — so the layer needs no CSP host and no wmscache entry. A tile the
   footprint never reached answers 404, which is also what a tile outside the
   acquisition should answer.
6. **Manifest** — `manifest.json` beside the tiles: acquisition, RVT version,
   both presets, the blend order, azimuth, the combined opacity, and per level
   the resolution, `r_max`/`r_min` in pixels and metres, overlap and encoding —
   plus a digest. A run against an existing manifest with a different digest
   stops rather than mixing two caches in one directory. The digest covers
   everything but the per-level block: which levels an invocation happens to
   build is not a property of the cache, and a store holding z15 has to accept
   the run that adds z14. Each level's entry is derived from z and the settings
   the digest does cover, so nothing escapes it. Acquisitions accumulate for the
   same reason and are outside it too; each names its own levels and its own
   `path`, which is the directory above and the app's tile template.

## Acceptance

The gates, and where they stand after the z15 pilot:

- `coverage.py` reproduces 1,106 km² for the fixture acquisition, and the
  rasteriser returns 879.2 km² for the 879.17 km² footprint. **Holds.**
- A pilot completes, resumes, and shows no seams at work-unit boundaries.
  **Holds** over 40 units: a re-run skips every marked unit and takes the next
  batch, and the step across a unit join measures the same as the step between
  adjacent columns inside one.
- Bytes per pixel from the pilot replace the single-patch figures wherever a
  budget is quoted. **Done** — §5.
- Changing one preset value produces a manifest that declares itself different
  and refuses to write into the old cache. **Holds.**
- Then the full run. A work unit is the same 2096 px square at every level, so
  it costs the same 11–13 s wherever it is, and the unit count quadruples per
  level down: over the fixture, 941 at z15 and 3,764 at z16. On the pilot's
  rate, the whole 0.25 m ladder is **~16.5 core-hours**, ~90 GB fetched and
  **~3.3 GB written** for 1 106 km² — of which z16 is three quarters. z15–z12
  alone, which is all a 0.5 m flight is owed, stays at ~4.5 core-hours and
  ~0.9 GB.

## Constraints carried from the repo

- Kartverket elevation is NLOD/CC BY, so caching derived rasters is fine. NiB
  imagery is not, and none of it goes near this.
- When this eventually reaches the UI, the ground's name is de-branded and needs
  `nb`, `nn` and `en`. Not this task.
- Nothing here may become a dependency of the SPA build.
