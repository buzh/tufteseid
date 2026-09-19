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
```

`vatcache.py` is the whole command line. An acquisition is named by its number
in the list, never by a path:

```
.venv/bin/python vatcache.py -l                 the shortlist, and what is built
.venv/bin/python vatcache.py -l -v              the figures behind it
.venv/bin/python vatcache.py -l --all østfold   everything Kartverket flew
.venv/bin/python vatcache.py -g 7 --dry-run     unit counts, nothing written
.venv/bin/python vatcache.py -g 7 --levels 15 --limit 20   pilot
.venv/bin/python vatcache.py -g 7 --jobs 4      the run
.venv/bin/python vatcache.py -c 7               audit it afterwards
.venv/bin/python vatcache.py -c 7 -g            audit it, then repair it
.venv/bin/python vatcache.py -c                 audit the whole store
```

`--out` is the store and defaults to `/site/tufteseid/data/cvat`.

**One index picks everything.** The footprint mask, the DEM request, the marker
directory and the manifest entry all come off the same number, which is what
retires the one mistake the batch could make silently: a mask paired with a
project that never flew the ground it points at returns all-NaN for every unit,
writes no tile, and marks each one done, leaving a store that looks built and is
empty. Masks are derived on first `--get` and cached beside the script as
`coverage-<slug>.npz`; they and `.venv/` are build artefacts, neither committed.

`-l` reads the shortlist in `acquisitions.json` and annotates each row from the
store's manifest. Anything the store holds that is not on the shortlist is
appended, so an off-list acquisition can still be checked and extended. `-v`
additionally asks hoydedata.no and the per-project WMS whether they still
publish each name — the two ways an acquisition fails are nothing to render and
tiles nobody asks for, and they are invisible from the store alone.

## Checking a store

`-c` reads the markers, not the tiles, for what *should* be there: a work unit
the footprint merely clips can legitimately hold no tile, and only the marker
separates that from a unit that never ran. It then decodes every tile the marked
units own — a full decode rather than a header read, because the failure worth
finding is truncation and a truncated WebP carries an intact header. Around 5 ms
a tile, so narrow it with `--levels` when you only want one.

What it reports, and what each means:

| Line | What happened |
| --- | --- |
| *n* units never built | the run stopped, or `--limit` cut it |
| *n* tiles do not decode | a write that did not survive; the app draws a broken image |
| *n* half-written `.part` files | killed mid-write, before the rename |
| *n* markers outside the footprint | the mask or `--unit-tiles` changed since the run |
| *n* finished units hold no tile | the footprint edge — normal, unless it is *every* unit, which is the mask and the DEM being of different ground |
| *n* tiles belong to no finished unit | store-wide only: tiles no acquisition in the manifest claims |

Adding `-g` repairs it. Both kinds of damage are repaired the same way — delete
the unit's tiles, drop its marker, let the build take it again. The tiles go
first because a rebuild that decides a tile is all-NaN writes nothing there, so
a broken file left in place would outlive the repair meant to clear it.

Orphan tiles are reported and never deleted. The namespace is shared, so a tile
outside one acquisition's units may well be inside another's, and the only
honest answer is the store-wide one.

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
| `vatcache.py` | The command line: the numbered list, the build, the audit and the repair. The only file with a `main` |
| `acquisitions.py` | Acquisition identity: the shortlist, and the two name sets — hoydedata's catalogue and the per-project WMS — that have to carry a name verbatim before its tiles reach a reader |
| `acquisitions.json` | The shortlist itself, in the order `--get` indexes. Committed, so an index means the same thing between two invocations |
| `cvat.py` | RVT's combined VAT: the parameters out of `VAT_Combined.rft.xml`, and the layer walk out of `render_all_images`. The one module that decides what a pixel is |
| `build_tiles.py` | The store: its geometry, a level built into it, the manifest, the markers, and the audit that reads all of it back |
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

The eight that survived that ranking are `acquisitions.json`, and `-l -v` prints
them with the store's own state beside each. The file is the list rather than
this table because `--get` indexes it: a ranking that lived in prose could not
be pointed at by a number.

Two traps the raw count walks into. **Filter the category**: Oslo 10pkt 2024
reads 27 lokaliteter/km² unfiltered and 3.86 as `L-ARK` — the rest is SEFRAK and
bygningsmasse in a built-over city, which is not ground anyone reads relief off.
**Check the overlap**: NDH Østfold 5pkt 2015 shares 648 km² with del1 2022, so
they are two vintages of one landscape and only one belongs in a store whose
tiles share a namespace. That pair is recorded as `overlaps` in the file, and
`--get` refuses the second of them without `--force`.

The acquisition name must also appear verbatim in the per-project WMS
`GetCapabilities`. That is what the app joins the manifest to: without the
catalogue row there is no footprint to rank the cache by and no envelope to
cull with, so `resolveCvatAcquisitions` drops the acquisition with a console
warning and its tiles are never asked for. `-l -v` and `-c` both check it.

To add a ninth, find it with `-l --all <substring>` and write a row for it:
`name` exactly as both services spell it, `coverage_km2`, `lokaliteter`,
`per_km2`, and `overlaps` if it shares ground with one already listed.
