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

P="Vestfold og Telemark 5pkt 2021"
.venv/bin/python coverage.py "$P" coverage-vt-2021.npz

OUT=/site/tufteseid/data/cvat
ARGS="--out $OUT --project $P --coverage coverage-vt-2021.npz"
.venv/bin/python build_tiles.py $ARGS --dry-run                  # unit counts
.venv/bin/python build_tiles.py $ARGS --levels 15 --limit 20     # pilot
.venv/bin/python build_tiles.py $ARGS --jobs 4
```

`--project` has no default and the mask names the acquisition it is of, because
the two have to agree: pinning the fetch to a project that never flew the ground
the mask points at is silent otherwise. Every unit returns all-NaN, writes no
tile, and marks itself done, leaving a store that looks built and is empty.

`coverage-*.npz` and `.venv/` are build artefacts; neither is committed.

## Several acquisitions in one store

Tiles from different acquisitions share the `<z>/<x>/<y>` namespace. That is
safe — a tile carries no provenance, and acquisitions chosen not to overlap do
not contend for one. The manifest's `acquisitions` block is the record of what
is in the store and at which levels.

Markers are *not* shared. They live at `.units/<acquisition-slug>/<z>/`, because
two acquisitions can fall inside one work unit while owning different tiles in
it: Vestfold og Telemark 5pkt 2021 and Viken laser - Østfold 5pkt del1 2022
share exactly two z12 units and no tiles at all, and one's marker must not
persuade the other that its own tiles are written.

Adding another acquisition does not change the recipe, so it does not change
the digest and needs no `--force`.

The app reads the manifest, so that is the whole deploy: finish a run, and the
acquisition is a row in the LiDAR dataset pulldown on the next page load. No
rebuild, no code change, nothing to restart — `file_server` is already serving
both the manifest and the tiles.

`--out` is the store `docker-compose.yml` bind-mounts read-only into the Caddy
container at `/var/www/cvat`, which is under Caddy's root — so a tile written
here is served at `/cvat/<z>/<x>/<y>.webp` without a route of its own. The app
asks for them as **Arkeologisk relieff**, a dataset in the LiDAR ring with one
row per acquisition the viewport touches
(`src/map/layers/config/backgroundLayers/cvatGround.ts`, `docs/map-layers.md`);
an install without the store answers 404 for the manifest, which reads as an
empty store and takes the rows off the list entirely.

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

## Choosing the next acquisition

Rank on the register this app is read against, not on area. Archaeological
lokaliteter only — `lokalitetskategori = L-ARK` on geonorge's Kulturminner WFS,
counted per 5 km cell with `resultType=hits` and weighted by that cell's covered
fraction of the footprint union, so the figure is lokaliteter *inside the
acquisition* rather than inside its envelope.

| Acquisition | Coverage | Ark. lokaliteter | per km² |
| --- | ---: | ---: | ---: |
| Viken laser - Østfold 5pkt del1 2022 *(built)* | 997 km² | ~6 460 | 6.48 |
| NDH Østfold 5pkt 2015 | 1 154 km² | ~6 610 | 5.72 |
| Hedmarken 5pkt del1 2025 | 856 km² | ~4 060 | 4.74 |
| Viken laser - Østfold 5pkt del2 2022 | 571 km² | ~2 620 | 4.59 |
| NDH Jæren-Randaberg-Sola 5pkt 2017 | 1 088 km² | ~4 470 | 4.11 |
| Vestfold 10pkt 2025 | 905 km² | ~3 710 | 4.10 |
| Vestfold og Telemark 5pkt 2021 *(built)* | 1 106 km² | ~3 610 | 3.26 |
| Viken laser - Romerike 5pkt 2022 | 845 km² | ~1 730 | 2.05 |

Two traps the raw count walks into. **Filter the category**: Oslo 10pkt 2024
reads 27 lokaliteter/km² unfiltered and 3.86 as `L-ARK` — the rest is SEFRAK and
bygningsmasse in a built-over city, which is not ground anyone reads relief off.
**Check the overlap**: NDH Østfold 5pkt 2015 shares 648 km² with del1 2022, so
they are two vintages of one landscape and only one belongs in the store.

The acquisition name must also appear verbatim in the per-project WMS
`GetCapabilities`. That is what the app joins the manifest to: without the
catalogue row there is no footprint to rank the cache by and no envelope to
cull with, so `resolveCvatAcquisitions` drops the acquisition with a console
warning and its tiles are never asked for. Every name above matches.
