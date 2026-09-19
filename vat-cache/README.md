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
.venv/bin/python vatcache.py -l                 the queue, and what is built
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

**How deep is not asked for.** `--get` reads the cell size hoydedata.no
publishes the acquisition on and builds down to the last level whose pixel is no
finer: z16 on a 0.25 m DTM, z15 on 0.5 m, z14 on 1 m. Below the cell the service
resamples one height value into four pixels and RVT renders the interpolation as
if it were terrain. `--levels` overrides it, which is what the pilot line above
is doing. `-c` without `--levels` checks whatever the manifest says is there, so
a 0.5 m flight is not reported as missing the z16 it was never owed.

**One index picks everything.** The footprint mask, the DEM request, the tile
directory, the marker directory and the manifest entry all come off the same
number, which is what retires the one mistake the batch could make silently: a
mask paired with a project that never flew the ground it points at returns
all-NaN for every unit, writes no tile, and marks each one done, leaving a store
that looks built and is empty. Masks are derived on first `--get` and cached
beside the script as `coverage-<slug>.npz`; they and `.venv/` are build
artefacts, neither committed.

`-l` reads the queue in `acquisitions.json` and annotates each row from the
store's manifest. Anything the store holds that is not on the queue is appended,
so an off-list acquisition can still be checked and extended. `-v` additionally
asks hoydedata.no and the per-project WMS whether they still publish each name —
the two ways an acquisition fails are nothing to render and tiles nobody asks
for, and they are invisible from the store alone — and prints the ladder each
one's cell size earns.

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
| *n* tiles belong to no finished unit | tiles under this acquisition that none of its finished units claims |

Adding `-g` repairs it. Both kinds of damage are repaired the same way — delete
the unit's tiles, drop its marker, let the build take it again. The tiles go
first because a rebuild that decides a tile is all-NaN writes nothing there, so
a broken file left in place would outlive the repair meant to clear it.

Orphan tiles are reported and never deleted. Reporting them is unambiguous now
that each acquisition owns a directory; deleting them still is not, because the
reason one is there is usually a `--unit-tiles` that changed between runs.

## Several acquisitions in one store

Each owns a directory: `<acquisition-slug>/<z>/<x>/<y>.webp`, with the slug
recorded in the manifest as that acquisition's `path` and nowhere else, so the
app has a template to read and no second copy of the slug rule to drift from.
Markers sit under the same slug, at `.units/<acquisition-slug>/<z>/`.

**Overlap is the reason, and it is wanted.** Two flights over one landscape are
two readings of it — Vestfold og Telemark 5pkt 2021 and Vestfold 10pkt 2025 are
not the same ground twice — so the app offers both as rows in the LiDAR ring and
a reader can put one against the other. One namespace would have had them
overwrite each other's pixels, and a tile carries nothing that says who made it.

Adding another acquisition does not change the recipe, so it does not change
the digest and needs no `--force`.

The app reads the manifest, so that is the whole deploy: finish a run, and the
acquisition is a row in the LiDAR dataset pulldown on the next page load. No
rebuild, no code change, nothing to restart — `file_server` is already serving
both the manifest and the tiles.

`--out` is the store `docker-compose.yml` bind-mounts read-only into the Caddy
container at `/var/www/cvat`, which is under Caddy's root — so a tile written
here is served at `/cvat/<slug>/<z>/<x>/<y>.webp` without a route of its own.
The app asks for them as **Arkeologisk relieff**, a dataset in the LiDAR ring
with one row per acquisition the viewport touches
(`src/map/layers/config/backgroundLayers/cvatGround.ts`, `docs/map-layers.md`);
an install without the store answers 404 for the manifest, which reads as an
empty store and takes the rows off the list entirely.

`--no-deps` is not optional: rvt-py declares gdal, rasterio, geopandas and
jupyter for an IO layer none of this uses.

## The files

| File | What it does |
| --- | --- |
| `vatcache.py` | The command line: the numbered list, the build, the audit and the repair. The only file with a `main` |
| `acquisitions.py` | Acquisition identity: the queue, the published cell size that sets the ladder, and the two name sets — hoydedata's catalogue and the per-project WMS — that have to carry a name verbatim before its tiles reach a reader |
| `acquisitions.json` | The queue itself, in the order `--get` indexes. Committed, so an index means the same thing between two invocations |
| `cvat.py` | RVT's combined VAT: the parameters out of `VAT_Combined.rft.xml`, and the layer walk out of `render_all_images`. The one module that decides what a pixel is |
| `build_tiles.py` | The store: its geometry, a level built into it, the manifest, the markers, and the audit that reads all of it back |
| `fetch_dem.py` | `exportImage` against `Prosjekt_DTM`, pinned to one `LAS_PROJECT_NAME`, plus the minimal tiled-float32 TIFF reader `dem.ts` also carries |
| `coverage.py` | What ground an acquisition covers: catalogue rows, union rasterisation, sample-site picker, tile fill against the app's tile grid |
| `compare.py` | The candidate grids and radius rules, rendered side by side on one real patch — what decided §1 and §2 of the work order, including the z16-against-z15 pair |
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
- **The ladder is z16 → z12** on the app's shared grid — the DTM is published at
  0.25 m, and z16 is 0.331 m/px — which is 3 764 / 941 / 313 / 116 / 46 work
  units of 4×4 tiles.
- **Compute is the constraint at z16 and nowhere else.** A work unit is the same
  2096 px square at every level, so it costs the same 11–13 s wherever it is,
  fetch included: ~12.5 core-hours for z16 against ~4.5 for the four levels
  below it.
- **Tiles are RGBA WebP q90.** An opaque alpha channel is free (0.339 B/px
  either way) and a half-covered tile is cheaper (0.153), so alpha is how
  no-data is stored rather than a grey that would look like ground.
- **z15 → z12 is under a gigabyte; z16 is three times the rest together.**
  Measured over 40 z15 units: 0.280 B/px on fully covered tiles, 0.259 over
  covered ground, which puts z15 at 0.66 GB and the four levels at ~0.9 GB
  against ~25 GB fetched. z16 quadruples the pixels at ~0.89 of the bytes each
  (0.288 and 0.324 B/px against z15's 0.320 and 0.364 on `compare.py`'s two
  sites), so ~2.4 GB more, ~3.3 GB in all, against ~90 GB fetched.
- **Halving the grid resolves structure, not noise.** That falling bytes-per-
  pixel is the evidence: encode cost rises with entropy, and the metre-locked
  rule that *does* degrade sampling goes the other way (0.329 → 0.503 as it
  coarsens). Against the 0.25 m data, z16 separates tracks, ditches and low
  mounds that z15 renders as one smear.
- **Seams do not appear** at work-unit boundaries with a 24 px overlap: the step
  across a unit join measures the same as the step between any two adjacent
  columns inside one.

## Choosing the next acquisition

The goal is the whole map, browsable without noticing where one flight stops. So
the question is not which ground is worth having — all of it is — but which
order fills it, and the answer is resolution first.

**Only the 0.25 m flights.** That is what the z16 base is built to read, and
it is the deepest grid published anywhere in the country. `LOWPS` on the mosaic
catalogue says which: exactly three values nationally, 1 m for 1–3 pkt, 0.5 m
for 2–4 pkt, 0.25 m for 5 pkt and up — 639 of the 1 536 acquisitions.
`acquisitions.native_cells` asks it, and `--get` builds the ladder that answer
earns whatever `acquisitions.json` says.

**Then density, then geography.** Above 5 pkt the cell stops shrinking and the
extra returns buy detail inside the 0.25 m grid instead, so the 10, 30 and
50 pkt flights come first; after that the queue fills outward from ground the
store already holds, because a map fills as a region and not as scattered
patches. Not blindly, though — the densest rows in the catalogue are a 1 km²
glacier at Oppdal and a lake-bottom survey at Hovsvatn, which are not landscapes
anyone browses.

**Overlap is not a reason to skip one.** Vestfold 10pkt 2025 lies on top of the
fixture acquisition at twice the density; Larvik 10pkt 2010 lies under both,
fifteen years earlier. All three belong in the store — each is a row, and a
reader can put one against the other. The app picks the deepest ladder that
covers the view and leaves the rest in the pulldown.

**Archaeology does not enter into it**, and an earlier version of this file said
otherwise: it ranked candidates by `L-ARK` lokaliteter per km² off geonorge's
Kulturminner WFS. Two things were wrong with that. The lesser one is factual —
it explained Oslo's inflated raw count as "SEFRAK and bygningsmasse", but SEFRAK
is not in that WFS at all; the 10 407 non-`L-ARK` records over Oslo are 10 289
`L-BVF` (buildings) and 118 `L-KRK` (churches). The greater one is that the
count measures where somebody has already looked. Two thirds of the `L-ARK`
records in the eastern counties are Funnsted, Bosetning/aktivitetsområde,
Bergkunst and Kokegrop — categories with no relief signature at all — so the
ranking was partly a map of excavation history. An amateur reading relief for
something nobody has registered yet wants the sharpest ground available, not the
best-surveyed.

The acquisition name must appear verbatim in the per-project WMS
`GetCapabilities` as well as in the catalogue. That is what the app joins the
manifest to: without the catalogue row there is no footprint to rank the cache
by and no envelope to cull with, so `resolveCvatAcquisitions` drops the
acquisition with a console warning and its tiles are never asked for. `-l -v`
and `-c` both check it.

To extend the queue, find candidates with `-l --all <substring>` and write a row
for each: `name` exactly as both services spell it, plus `pkt`, `cell_m` and
`where` for the reader. Only the name has to be right — the ladder comes off the
catalogue, not off the file.
