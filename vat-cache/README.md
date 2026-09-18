# vat-cache — building the cached cVAT ground

Out-of-band tooling, not part of the SPA build. Nothing in `src/` imports it,
the docker build does not see it, and `package.json` is untouched. It runs on
whatever machine can reach `hoydedata.no` directly and has python.

RVT computes the pixels. `rvt.vis` makes the four layers and `rvt.blend_func`
blends them; nothing here reimplements a visualization. `WORK-ORDER.md` is the
brief and records why the parameters are what they are.

## Running

```
python -m venv .venv
.venv/bin/pip install -r requirements.txt --no-deps    # see requirements.txt
.venv/bin/pip install "numpy<2.1" "scipy<1.15" pillow matplotlib

.venv/bin/python coverage.py "Vestfold og Telemark 5pkt 2021"   # -> coverage.npz

OUT=/site/tufteseid/data/cvat
.venv/bin/python build_tiles.py --out $OUT --dry-run             # unit counts
.venv/bin/python build_tiles.py --out $OUT --levels 15 --limit 20
.venv/bin/python build_tiles.py --out $OUT --jobs 4
```

`coverage.npz` and `.venv/` are build artefacts; neither is committed.

`--out` is the store `docker-compose.yml` bind-mounts read-only into the Caddy
container at `/var/www/cvat`, which is under Caddy's root — so a tile written
here is served at `/cvat/<z>/<x>/<y>.webp` without a route of its own. Nothing
in the app asks for one yet; registering the ground is a later task.

`--no-deps` is not optional: rvt-py declares gdal, rasterio, geopandas and
jupyter for an IO layer none of this uses.

## The files

| File | What it does |
| --- | --- |
| `cvat.py` | RVT's combined VAT: the parameters out of `VAT_Combined.rft.xml`, and the layer walk out of `render_all_images`. The one module that decides what a pixel is |
| `build_tiles.py` | The batch: coverage → work units → fetch → `cvat` → 512 px RGBA WebP on the app's tile grid, with a manifest and resume |
| `fetch_dem.py` | `exportImage` against `Prosjekt_DTM`, pinned to one `LAS_PROJECT_NAME`, plus the minimal tiled-float32 TIFF reader `dem.ts` also carries |
| `coverage.py` | What ground an acquisition covers: catalogue rows, union rasterisation, sample-site picker, tile fill against the app's tile grid |
| `compare.py` | The candidate grids and radius rules, rendered side by side on one real patch — what decided §1 and §2 of the work order |
| `render.py` | The numpy port of `shade.ts` the sizing study was done with. Superseded by `cvat.py` for anything that renders; kept because `measure.py` and `sizing.py` read against it |
| `measure.py` | Renders samples, quantises, tiles, encodes — bytes per pixel per product |
| `sizing.py` | Measured bytes per pixel + coverage → disk cost per zoom on the app's real ladder |

## What is established

For **Vestfold og Telemark 5pkt 2021**:

- **Coverage is 1,106 km²**, not the 8,846 km² that summing `SHAPE.AREA` over
  the 270 catalogue rows suggests — the catalogue carries a row per overview
  level and each level re-covers the project. Envelope 185.6 × 102.9 km, 6 %
  filled. The rasteriser validates against a known 879.17 km² footprint to
  879.2 km². Native DTM is 0.25 m, with overviews doubling from there.
- **RVT's radii are pixels.** `max_rad` 10 px (general) and 20 px (flat) come to
  5 m and 10 m only on the 0.5 m DEM the templates were calibrated on. The cache
  holds the pixels, so every level is RVT's combined VAT of its own grid.
- **The ladder is z15 → z12** on the app's shared grid, 941 / 313 / 116 / 46
  work units of 4×4 tiles.
- **Compute is not the constraint.** A work unit is the same 2096 px square at
  every level, so it costs the same 11–13 s wherever it is, fetch included:
  ~3 core-hours for z15's 941 units and ~1.6 for the 475 above it.
- **Tiles are RGBA WebP q90.** An opaque alpha channel is free (0.339 B/px
  either way) and a half-covered tile is cheaper (0.153), so alpha is how
  no-data is stored rather than a grey that would look like ground.
- **The whole ladder is under a gigabyte.** Measured over 40 z15 units: 0.280
  B/px on fully covered tiles, 0.259 over covered ground, which puts z15 at
  0.66 GB and the four levels at ~0.9 GB against ~25 GB fetched.
- **Seams do not appear** at work-unit boundaries with a 24 px overlap: the step
  across a unit join measures the same as the step between any two adjacent
  columns inside one.
