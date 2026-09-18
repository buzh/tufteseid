# Work order — DEM fetch/transform tooling, first use a cached VAT ground

## The job

Build tooling that fetches float DEM for an arbitrary area and transforms it
into a tiled raster product, with the render settings as parameters of a run
rather than constants in a script. The framework is the deliverable; **the only
planned use is one cached VAT layer** over a named LiDAR acquisition, and
nothing here should be generalised past what that use needs.

Not in this task: no UI, no layer registration, no locale strings, no change
under `src/`. This produces a tile store and the tool that made it.

## Why VAT first, and why it is the easy one

Of the four visualizations measured, VAT is the only one that tiles without a
global stretch pass: `composeVat` mixes its layers on the absolute stretches in
`VAT_PRESETS` and composites to 0..1, which is exactly why `render.ts` gives it
no case in its stretch switch. The horizon family stretches on each render's own
2–98 percentiles, and a per-tile percentile makes neighbouring tiles disagree —
the fault that got `dynamisk_farget_hoyde` excluded in `lidarProjects.ts`.
Caching those three means first choosing and freezing a stretch per level, which
changes what the existing views mean. VAT needs no such decision.

VAT is also the one the client renders worst. `vatDecimation` puts it on a 1.0 m
grid for a 1000 m rectangle and 0.75 m from 548 m up — only rectangles under
548 m get the 0.5 m `VAT_SCAN_M_PER_PX` the presets were calibrated at. A cache
is computed once, so it can hold a better grid than the tab can afford, over
ground no rectangle reaches.

## What is already measured

From the six-site study in this folder, over `Vestfold og Telemark 5pkt 2021`:

| | |
| --- | --- |
| Coverage | **1,106 km²** (union of footprints; `sum(SHAPE.AREA)` says 8,846 and is wrong — overview rows) |
| VAT bytes per pixel | 0.607 PNG, 0.257 WebP q90, on 256 px tiles |
| VAT compute | 8.4 s per km² at 0.5 m, one core |

Everything below follows from those three plus the app's zoom ladder. Re-run
`sizing.py` after changing any of them.

## Decisions, with recommendations

### 1. Base grid: z15 on the app's own ladder

`wmsTileGrid.ts` builds resolutions as `21664 / 2**z` over the EPSG:25833
extent, 512 px tiles. So the ladder near VAT's calibration grid is z14 at
1.3223 m/px, z15 at 0.6611, z16 at 0.3306 — none of them 0.5 m.

| option | grid | pixels | PNG | WebP q90 |
| --- | --- | --- | --- | --- |
| **z15 base + z14/z13/z12** | 0.661 m | 3.36 Gpx | **2.41 GB** | **1.02 GB** |
| z15 only | 0.661 m | 2.53 Gpx | 1.73 GB | 0.73 GB |
| z16 base + four coarser | 0.331 m | 13.48 Gpx | 8.88 GB | 3.76 GB |
| custom 0.5·2ⁿ grid, 0.5 m base | 0.500 m | 5.90 Gpx | ~3.89 GB | ~1.65 GB |

**Take z15.** It is 0.661 m against a 0.5 m calibration, and that difference
moves in the safe direction: the slope layer's sensitivity to DEM noise falls
with cell size (3 cm over two cells is 3.4° at 0.25 m, 1.7° at 0.5 m, ~1.3° at
0.661 m) against a 15° stretch in the flat preset. The flat preset's 10 m reach
still resolves to 15 px = 9.9 m there. And the client itself already runs VAT at
0.75–1.0 m for most of the rectangle band, so the cache is *finer* than what a
reader sees today on any lokalitet over ~610 m.

A custom 0.5·2ⁿ grid would hit the calibration resolution exactly, at 61 % more
disk and a second tile grid in an app whose shared one exists because "a guessed
grid misaligns". Not worth it. z16 is finer than calibration, which
`terrain-analysis.md` already records as buying grain rather than ground.

### 2. Encoding: WebP q90, with a caveat recorded

0.72 GB against 1.72 GB for the same pixels. VAT is an 8-bit grey visualization,
not measurement data, so lossy is defensible for a served ground. The caveat is
that a plate must not be generated from cached pixels — `src/figure/` renders
from the float field through `paintTerrainField`, and it should keep doing that.
If a screenshot of the cached ground ever becomes an attachment, the manifest's
encoding line is what makes it honest.

### 3. Fetch direct, not through wmscache

~10 GB of float TIFF at z15, ~13.5 GB with the coarser levels. Routing that
through wmscache would evict most of its 25 GB LRU for one-shot reads. The batch
job talks to `hoydedata.no` directly and writes to its own volume; the cache
volume is separate from the wmscache one.

### 4. Work tiles carry a margin

Same reason `fetchDem` does: a horizon ray that walks off the grid reads as
nothing there to block the sky, so an unmargined tile grid renders a bright
frame around every tile and the seams are visible. Use `DEM_MARGIN_M` (24 m)
even though VAT's own longest reach is 10 m — it is the app's constant and the
tooling is meant to serve the horizon family later.

## Shape of the tool

1. **Acquisition** — `LAS_PROJECT_NAME` in, footprint union out, as
   `coverage.py` already does. Work units are tiles of the target grid, ordered,
   resumable, and skipped where the footprint does not reach. Sparse TIFF means
   no coverage, not an error.
2. **Fetch** — `exportImage`, `pixelType=F32`, `renderingRule` `None`, mosaicRule
   pinned to the acquisition, margin added and cropped after render. Retry and
   rate-limit handling; this is the step that will fail overnight.
3. **Render** — `render.py`'s operators, settings supplied per run.
4. **Write** — 512 px tiles on the app's grid, plus the coarser levels, each
   computed from DEM rather than resampled (measured: natively computed coarse
   levels are *cheaper* per pixel than resampled overviews, 0.600 against 0.756
   B/px for openness at 4 m — the wider absolute stretch costs less entropy).
5. **Manifest** — one file beside the tiles recording acquisition, model, grid
   resolution per level, margin, encoding, and the full settings the run used:
   `VAT_PRESETS` both of them, `VAT_STACK`, azimuth, z-factor,
   `VAT_GENERAL_OPACITY`, `SVF_DIRECTIONS`. This is the same contract the figure
   plate keeps — a render that cannot state its parameters cannot be checked by
   anyone — and it is what makes "adjust the settings easily" safe, because a
   cache built under changed settings is a different cache and has to be able to
   say so.

## Acceptance

- **Parity.** One bbox rendered by `render.py` and by the browser's own Analyse
  path agree to within quantisation. Run on the server, where node lives. Any
  disagreement is a bug in `render.py`, not in `shade.ts`.
- `coverage.py` reproduces 1,106 km² for the fixture acquisition, and the
  rasteriser still returns 879.2 km² for the 879.17 km² footprint.
- A pilot run over ~20 km² completes, resumes correctly after a kill, and its
  tiles show no seams at work-unit boundaries.
- The manifest round-trips: changing one preset value produces a cache that
  declares itself different.
- Only then the full 1,106 km² run: ~1.9 core-hours of arithmetic, ~13.5 GB
  fetched, ~1.0 GB written.

## Constraints carried from the repo

- Kartverket elevation is NLOD/CC BY, so caching derived rasters is fine. NiB
  imagery is not, and none of it goes near this.
- When this eventually reaches the UI, the ground's name is de-branded and needs
  `nb`, `nn` and `en`. Not this task.
- Nothing here may become a dependency of the SPA build.
