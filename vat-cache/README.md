# vat-cache

Precomputes RVT's combined VAT over one Norwegian LiDAR acquisition into one
`<slug>.mbtiles`, which the `cvat-tiles` sidecar serves at `/cvat/*`. Out of
band — nothing in `src/` imports it and the docker build does not see it. Needs
python, disk and a direct route to `hoydedata.no`, not the machine that serves
the tiles. Deploy is a copy into `/site/tufteseid/data/cvat`.

## Install

```
python -m venv .venv
.venv/bin/pip install -r requirements.txt --no-deps
.venv/bin/pip install "numpy<2.1" "scipy<1.15" pillow matplotlib
```

- `--no-deps` is required: rvt-py declares gdal, rasterio, geopandas and jupyter
  for an IO layer none of this uses. The second line installs the four real
  dependencies *with* their own deps (matplotlib will not import without).
- `scipy<1.15`: `rvt.vis` imports `scipy.ndimage.morphology`, removed in 1.15.
- `numpy<2.1` is the last line supporting python 3.9; drop it on a newer one.
- `cvat.py` avoids `rvt.blend.BlenderCombination`, which pulls `rvt.default` →
  `rvt.tile` → `osgeo.gdal`.

## Building an acquisition

```
.venv/bin/python makevat.py -l                  numbered catalogue
.venv/bin/python makevat.py -l vestfold         filtered by substring
.venv/bin/python makevat.py -l -v vestfold      + ladder, WMS name check, mask
.venv/bin/python makevat.py -l --refresh        re-ask hoydedata.no
.venv/bin/python makevat.py -g 1421 --dry-run   unit counts, nothing written
.venv/bin/python makevat.py -g 1421 -z 15 --limit 20     pilot
.venv/bin/python makevat.py -g 1421 --jobs 4    the run
.venv/bin/python makevat.py -c 1421             read every tile back
.venv/bin/python makevat.py -c 1421 -g          read it back, then repair
```

Also `-o DIR` (output, default `.`), `--unit-tiles N` (default 4), `--force`.

- **Numbers, not names** — names carry spaces, æøå and parentheses. Numbers
  index `catalogue.json`, an uncommitted local snapshot written on first use.
  `--refresh` appends rather than re-sorts, so a number keeps its meaning.
- **Depth is not asked for.** `levels_for` reads the published cell size
  (`LOWPS`; only 1 / 0.5 / 0.25 m occur nationally) and builds down to the last
  level whose pixel is no finer — z16 on 0.25 m, z15 on 0.5 m, z14 on 1 m. `-z`
  selects within that ladder — `-z 15`, `-z 16,14,12`, `-z 16-14`, deepest first
  — and is refused past it. `-c` takes the same spec with no such limit.
- **Resumable.** Each finished work unit is a row in the same database,
  including units that wrote no tile, so a killed run continues and `--limit`
  takes the *next* batch on a re-run.
- **Masks** are rasterised footprints, derived on first `-g` into
  `coverage-<slug>.npz`. They carry the acquisition name, so a mask paired with
  another acquisition's DEM aborts instead of writing an empty file.
- **Guards.** A file naming a different acquisition is refused outright; one
  built under a different recipe digest needs `--force`. The digest covers
  everything that decides a pixel — editing `cvat.py` changes it, adding a level
  does not.

## Deploying

```
scp vestfold-10pkt-2025.mbtiles server:/site/tufteseid/data/cvat/
```

No manifest, no import, nothing restarted. Each database's `metadata` carries
its acquisition name, levels and recipe; `cvat-tiles/server.mjs` surveys the
directory and synthesizes `/cvat/manifest.json`. Deleting the file removes the
acquisition. The sidecar re-surveys at most once per 10 s and drops handles on
size/mtime change, so replacing a file in place costs ≤10 s of stale tiles.

`name` must be **byte-identical** to hoydedata.no's `LAS_PROJECT_NAME` and to
the `LidarProject.id` the per-project WMS publishes — that is what the app joins
on; `-l -v` and both tools' `-c` check it. Audit with `makevat.py -c <n>` before
copying: a unit that never ran is cheaper to find here than after an rsync.

## Auditing a store

```
.venv/bin/python vatcache.py -l                 the queue, and what is built
.venv/bin/python vatcache.py -l -v              + cells, units, names, masks
.venv/bin/python vatcache.py -l --all østfold   everything in the catalogue
.venv/bin/python vatcache.py -c 7               one acquisition
.venv/bin/python vatcache.py -c                 the whole store
```

`-o` defaults to the served store. `-l` reads the committed queue in
`acquisitions.json` and annotates it from the databases present; anything in the
store but off the queue is appended. **The two tools number differently** —
`makevat.py` numbers the whole catalogue (~1 540), `vatcache.py` the queue (a
couple of dozen) — so `vatcache.py` hands faults over by name. `-c` takes the
`units` table as the authority on what should be there, then fully decodes every
tile those units own (~5 ms each; narrow with `-z`).

| Reported | Meaning |
| --- | --- |
| *n* units never built | the run stopped, or `--limit` cut it |
| *n* tiles do not decode | a rotted blob; the app draws a broken image |
| *n* finished units outside the footprint | the mask or `--unit-tiles` changed since the run |
| *n* finished units hold no tile | footprint edge; normal unless it is *every* unit |
| *n* tiles belong to no finished unit | orphans — reported, never deleted |

Repair is `makevat.py -c <n> -g`, against the store or a copy: it drops the
unit's tiles and record in one transaction and rebuilds.

## Grid and output

| | |
| --- | --- |
| Projection | EPSG:25833, the app's grid (`src/map/layers/wmsTileGrid.ts`) |
| Origin | `(-2500000, 9045984)`, north-west |
| Resolution | `21664 / 2**z` m/px — z16 = 0.331 m, z15 = 0.661 m |
| Tile | 512 px; `tile_row` is TMS, `2**(z-1) - 1 - y` |
| Levels | z16 down to z7; z11–z7 feed `src/map/cvatHintLayer.ts` |
| Work unit | 4×4 tiles + 24 px overlap = 2096 px, ~18 MB float32, one fetch |
| Overlap | 24 px = flat's `max_rad` 20 px + the 3×3 gradient window |
| Encoding | RGBA WebP q90; grey is RVT's `byte_scale`, alpha is coverage |
| Alpha below z12 | the footprint mask, not DEM no-data (`MASK_ALPHA_BELOW_Z`) |
| Container | one `<slug>.mbtiles` per acquisition. MBTiles rows, app-specific grid — a generic reader misplaces them |

Overlapping acquisitions each get their own database and appear as separate rows
in the LiDAR pulldown.

### The blend

Authoritative definition: `VAT_Combined.rft.xml` in
`EarthObservation/rvt-arcgis-pro` — **not** rvt-py's
`default_blender_combinations.json`, whose VAT combined entry has an empty layer
list. Transcribed into `cvat.py`:

| Layer, bottom first | general | flat |
| --- | --- | --- |
| Hillshade, normal 100 | 315° / 35° | 315° / 15° |
| Slope, luminosity 50 | 0–50° | 0–15° |
| Openness +, overlay 50 | 68–93° | 85–93° |
| Sky-view, multiply 25 | 0.7–1.0 | 0.9–1.0 |
| `svf_r_max` / `svf_noise` | 10 px / 0 | 20 px / 3 |

Combined is general over flat, normal, opacity 50; 16 directions, ve_factor 1.
`svf_noise` is a level 0–3 that `rvt.vis` maps to `r_min` = (0, 10, 20, 40) % of
`r_max`, so flat's inner radius is 8 px. Radii are RVT's **pixels**, verbatim at
every level (`radius_in_metres=False`), so each level is RVT's combined VAT of
its own grid and the reach changes with zoom.

## The files

| File | What it is |
| --- | --- |
| `makevat.py` | Build front end: catalogue, one acquisition into one file, repair. Knows nothing about a store |
| `vatcache.py` | Store front end: the queue, what is in it, the audit. Never writes |
| `build_tiles.py` | Grid geometry, the MBTiles container, a level built into it, the read-back |
| `cvat.py` | The combined VAT itself — presets, layer walk, `radii_for`. The only module that decides what a pixel is |
| `fetch_dem.py` | `exportImage` against `Prosjekt_DTM` pinned to one `LAS_PROJECT_NAME`, plus a minimal tiled-float32 TIFF reader |
| `coverage.py` | Footprint union rasterisation, sample-site picker, tile fill |
| `acquisitions.py` | Acquisition identity: queue, published cell sizes, the catalogue and WMS name sets |
| `acquisitions.json` | The build queue, committed, in the order `vatcache.py -l` indexes |
| `report.py` | Formatting and the shared audit, used by both front ends |
| `compare.py` | Benchmark: cVAT over one patch at every candidate grid under both radius rules; PNGs to `/tmp` |
| `render.py` | numpy port of `src/terrain/shade.ts`. Not used for building; `measure.py` and `sizing.py` read against it |
| `measure.py` | Bytes per pixel per product, measured. Reads `coverage.npz` |
| `sizing.py` | Measured bytes per pixel + coverage → disk cost per zoom |

## Gotchas

- **Fetch goes direct to hoydedata.no**, never through wmscache: ~90 GB of float
  TIFF would evict its 25 GB LRU several times over.
- **`exportImage` caps at 15 000 px a side** — hence one call per work unit. It
  answers a burst with a *text body under a 200 status*, surfacing as
  `RuntimeError`; `fetch_unit` retries 5× with backoff. This is the step that
  fails overnight.
- **Coarse requests return ground that was never flown**: ImageServer serves
  them from per-mosaic-item overviews that fill the item's whole rectangle. Over
  a 0.17 km² survey, half of a 21 km window at z8 came back as data. Hence the
  footprint alpha below z12.
- **Costs**, over 1 106 km² of 0.25 m ground: a work unit is the same 2096 px
  square at every level and takes 11–13 s wherever it is, fetch included. Full
  z16–z7 is ~16.5 core-hours, ~90 GB fetched, ~3.3 GB written, three quarters of
  it z16. z15–z12 (all a 0.5 m flight is owed) is ~4.5 core-hours, ~0.9 GB.
- **A half-built store is not a broken one.** Missing levels are simply not
  served; the sidecar publishes what `metadata.levels` says. There is no
  half-written tile — tiles and the unit record land in one transaction.
- **RVT's overlay opacity does nothing**, reproduced deliberately:
  `blend_overlay` writes through its `background`, so the openness layer's 50 %
  performs as 100 %. Every published VAT came out of that path.
- **Keep SQLite's default journal mode.** WAL writes two files beside the
  database, which the sidecar's read-only opener cannot create.
- **Never render a figure plate from cached pixels** — `src/figure/` goes
  through `paintTerrainField` on the float field.
- Kartverket elevation is NLOD/CC BY, so caching derived rasters is fine. NiB
  imagery is not, and none goes near this.
