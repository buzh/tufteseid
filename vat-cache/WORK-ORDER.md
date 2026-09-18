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

VAT is also the one the client renders worst. `vatDecimation` returns an integer
multiple of the DEM's own cell, so the ladder it walks depends on the
acquisition: over 0.5 m data the grid steps straight from 0.5 m to 1.0 m at a
548 m side, over 0.25 m data it goes 0.5 → 0.75 → 1.0. Either way only
rectangles under 548 m get the 0.5 m `VAT_SCAN_M_PER_PX` the presets were
calibrated at. A cache is computed once, so it can hold a better grid than the
tab can afford, over ground no rectangle reaches.

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
| **z15 base + z14/z13** | 0.661 m | 3.32 Gpx | **2.36 GB** | **1.00 GB** |
| z15 only | 0.661 m | 2.53 Gpx | 1.73 GB | 0.73 GB |
| z15 base + z14/z13/z12 | 0.661 m | 3.36 Gpx | 2.41 GB | 1.02 GB |
| z16 base + four coarser | 0.331 m | 13.48 Gpx | 8.88 GB | 3.76 GB |
| custom 0.5·2ⁿ grid, three levels | 0.500 m | 5.81 Gpx | 4.03 GB | 1.70 GB |

**Take z15.** It is 0.661 m against a 0.5 m calibration, and that difference
moves in the safe direction: the slope layer's sensitivity to DEM noise falls
with cell size (3 cm over two cells is 3.4° at 0.25 m, 1.7° at 0.5 m, ~1.3° at
0.661 m) against a 15° stretch in the flat preset. The flat preset's 10 m reach
still resolves to 15 px = 9.9 m there. Against what the client does today,
0.661 m is the better half of a trade: coarser than the 0.5 m a lokalitet under
548 m gets, finer than the 1.0 m everything above it gets.

A custom 0.5·2ⁿ grid would hit the calibration resolution exactly, at 70 % more
disk and a second tile grid in an app whose shared one exists because "a guessed
grid misaligns". Not worth it. z16 is finer than calibration, which
`terrain-analysis.md` already records as buying grain rather than ground.

### 2. Three levels: z15, z14, z13

`scanHorizon` clamps its search radius to whole cells, so the presets' 5 m and
10 m reaches shrink as the grid coarsens:

| level | m/px | general, 5 m | flat, 10 m (inner 4 m) |
| --- | --- | --- | --- |
| RVT calibration | 0.500 | 10 px | 20 px (8) |
| z15 | 0.661 | 8 px | 15 px (6) |
| z14 | 1.322 | 4 px | 8 px (3) |
| z13 | 2.645 | 2 px | 4 px (2) |
| z12 | 5.289 | **1 px** | 2 px (1) |

At z12 the general stack's openness is one cell's height difference wearing
openness' stretch — a signed slope, not a horizon. The presets are stated in
metres so that the angle is a fact about the ground rather than about the grid,
and that stops being true once a ray has one sample.

**Stop at z13.** Dropping z12 costs 0.02 GB, and the level is not the same
visualization as the one above it. This is the fault the absolute stretches
avoid, one axis over: tiles agree sideways, but a picture that changes as you
zoom is `dynamisk_farget_hoyde` rotated. z13 is kept, at a fifth of the
calibration radius, because a pyramid needs a floor and because it is read as
context rather than for a bank — the manifest records radius-in-pixels per level
so that judgement is the reader's to check.

### 3. Encoding: WebP q90, with a caveat recorded

1.00 GB against 2.36 GB for the same pixels. VAT is an 8-bit grey visualization,
not measurement data, so lossy is defensible for a served ground. The caveat is
that a plate must not be generated from cached pixels — `src/figure/` renders
from the float field through `paintTerrainField`, and it should keep doing that.
If a screenshot of the cached ground ever becomes an attachment, the manifest's
encoding line is what makes it honest.

Only the 0.5 m row of VAT is measured: `bpp_at` clamps to it, so z14 and z13 are
priced at the same 0.257 B/px. Openness got *cheaper* per pixel as its grid
coarsened, so the estimate errs high, but it is an extrapolation and the pilot
run is what turns it into a measurement.

### 4. Fetch direct, not through wmscache

One fetch at z15 and nothing at the coarser levels — see the write step — which
is ~17 GB of float TIFF: 10.1 GB of covered pixels, ÷0.65 for the ground in
partly-covered work units that gets fetched anyway, ×1.07 for the margin.
Routing that through wmscache would evict most of its 25 GB LRU for one-shot
reads. The batch job talks to `hoydedata.no` directly and writes to its own
volume; the cache volume is separate from the wmscache one.

Both overheads are real and they pull against each other, which is what fixes
the work-unit size in the next section: the margin is added to every unit and so
gets cheaper as units grow, while a unit the footprint only clips is fetched
whole and so gets dearer. `fetch_bytes` in `sizing.py` prints the curve — 14.9,
14.7, 16.7, 21.9 GB for units of one z15, z14, z13 and z12 tile.

### 5. Work units carry a margin, and it is a run parameter

Same reason `fetchDem` does: a horizon ray that walks off the grid reads as
nothing there to block the sky, so an unmargined tile grid renders a bright
frame around every tile and the seams are visible.

`DEM_MARGIN_M` (24 m) is the default, because it is the app's constant and the
tooling is meant to serve the horizon family later. On a 2048 px work unit it
costs 37 px a side, 1.07× the pixels fetched and about 1.1 GB; cutting it to the
10 m VAT actually reaches would save 0.7 GB, which is not a reason to carry a
VAT-specific margin. Make it a parameter of the run anyway, and record it in the
manifest: the horizon family will ask for a different one, and a cache that
cannot say how much real ground stood outside its tiles cannot be checked for
the seams this section exists to prevent.

## Shape of the tool

1. **Acquisition** — `LAS_PROJECT_NAME` in, footprint union out, as
   `coverage.py` already does. **The work unit is one tile of the coarsest
   level**, z13: 1354 m plus margin, fetched at z15 resolution, is 2122 px
   square and 18 MB of float, and it yields one z13 tile, four z14 and sixteen
   z15. Units are ordered, resumable, and skipped where the footprint does not
   reach. Sparse TIFF means no coverage, not an error.

   A z14-sized unit downloads 2 GB less (the curve in the section above), but
   then a z13 tile spans four units and cannot be written until all four are
   done — which is exactly the partial state that makes resume hard, and resume
   is a requirement here while 2 GB of one-off download is not. Pay it.
2. **Fetch** — `exportImage`, `pixelType=F32`, `renderingRule` `None`, mosaicRule
   pinned to the acquisition, margin added and cropped after render. One work
   unit is over the 2048² the service renders in one call, so it arrives as a
   small mosaic, the way `fetchDem` assembles one. Retry and rate-limit
   handling; this is the step that will fail overnight.
3. **Render** — `render.py`'s operators, settings supplied per run.
4. **Write** — 512 px tiles on the app's grid, plus the coarser levels. Each
   level's composite is computed on a grid at that level's resolution, never by
   resampling the rendered image (measured: natively computed coarse levels are
   *cheaper* per pixel than resampled overviews, 0.600 against 0.756 B/px for
   openness at 4 m — the wider absolute stretch costs less entropy). That grid
   is a block-mean decimation of the one fetch, by the factor `decimate` in
   `shade.ts` applies, not a second fetch: the margin is stated in metres so it
   survives decimation, and re-fetching z14 and z13 separately would add 5 GB of
   downloads to arrive at the service's own resampling instead of the block mean
   the client uses — a different surface, not a better one, and the wrong one to
   match if parity with `shade.ts` is the test.
5. **Manifest** — one file beside the tiles recording acquisition, model, grid
   resolution per level, horizon radius in pixels per level, margin, encoding,
   and the full settings the run used: `VAT_PRESETS` both of them, `VAT_STACK`,
   azimuth, z-factor, `VAT_GENERAL_OPACITY`, `SVF_DIRECTIONS`. This is the same
   contract the figure plate keeps — a render that cannot state its parameters
   cannot be checked by anyone — and it is what makes "adjust the settings
   easily" safe, because a cache built under changed settings is a different
   cache and has to be able to say so.

## Acceptance

- **Parity.** `render.py` and `shade.ts` handed *the same float grid* agree to
  within quantisation. The same grid, not the same bbox: going in through the
  browser's Analyse path drags `fetchDem`'s tiling and decimation into a
  comparison that is meant to be about the operators. Run on the server, where
  node lives. Any disagreement is a bug in `render.py`, not in `shade.ts`.
- `coverage.py` reproduces 1,106 km² for the fixture acquisition, and the
  rasteriser still returns 879.2 km² for the 879.17 km² footprint.
- A pilot run over ~20 km² completes, resumes correctly after a kill, and its
  tiles show no seams at work-unit boundaries.
- The manifest round-trips: changing one preset value produces a cache that
  declares itself different.
- Only then the full 1,106 km² run: ~1.3 core-hours of arithmetic, ~17 GB
  fetched, ~1.0 GB written. The compute figure scales the measured 8.4 s/km² by
  pixel count *and* by radius in cells, since the scan is the bulk of it and its
  radius shrinks with the grid; z14 and z13 together are a tenth of z15.

## Constraints carried from the repo

- Kartverket elevation is NLOD/CC BY, so caching derived rasters is fine. NiB
  imagery is not, and none of it goes near this.
- When this eventually reaches the UI, the ground's name is de-branded and needs
  `nb`, `nn` and `en`. Not this task.
- Nothing here may become a dependency of the SPA build.
