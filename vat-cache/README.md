# vat-cache — building the cached cVAT ground

Out-of-band tooling, not part of the SPA build. Nothing in `src/` imports it,
the docker build does not see it, and `package.json` is untouched. It runs on
whatever machine can reach `hoydedata.no` directly and has python — which need
not be the machine that serves the tiles, and for a 0.25 m acquisition had
better not be.

RVT computes the pixels. `rvt.vis` makes the four layers and `rvt.blend_func`
blends them; nothing here reimplements a visualization. `WORK-ORDER.md` is the
brief and records why the parameters are what they are.

There are two command lines, and the split is where the work happens:

| | |
| --- | --- |
| `makevat.py` | Renders one acquisition into one `<slug>.mbtiles`. Knows about hoydedata.no and nothing else — no store, no queue, no server. This is the build |
| `vatcache.py` | Keeps a store: which acquisitions are worth having and in what order, which ones are in it, and whether their tiles read back |

## Running

```
python -m venv .venv
.venv/bin/pip install -r requirements.txt --no-deps    # see requirements.txt
.venv/bin/pip install "numpy<2.1" "scipy<1.15" pillow matplotlib
```

`--no-deps` is not optional: rvt-py declares gdal, rasterio, geopandas and
jupyter for an IO layer none of this uses.

## Building an acquisition

```
.venv/bin/python makevat.py -l                 everything hoydedata.no carries
.venv/bin/python makevat.py -l vestfold        the ones whose name says so
.venv/bin/python makevat.py -l -v vestfold     with the ladder and the names
.venv/bin/python makevat.py -g 1421 --dry-run  unit counts, nothing written
.venv/bin/python makevat.py -g 1421 -z 15 --limit 20        pilot
.venv/bin/python makevat.py -g 1421 --jobs 4   the run
.venv/bin/python makevat.py -c 1421            read back what came out
.venv/bin/python makevat.py -c 1421 -g         read it back, then repair it
```

`-o` is where the file goes and defaults to the working directory. One
acquisition is one file and files do not overlap, so a build needs to know
nothing about the store it is destined for — or whether there is one.

**An acquisition is named by number, never by name.** The catalogue spells them
with spaces, æøå and parentheses, which a shell takes apart if you let it. `-l`
prints them numbered; `-g` and `-c` take the number. Those numbers come off a
local snapshot of hoydedata.no's catalogue, written as `catalogue.json` on first
use — a build artefact like the masks, uncommitted, because it is a copy of an
upstream service and two people on two machines have no reason to agree about
it. `--refresh` re-asks and puts what is new on the *end* rather than
re-sorting, so a number written down today still means the same acquisition next
month; a withdrawn acquisition keeps its number and stops being buildable.

**How deep needs no asking.** `-g` reads the cell size hoydedata.no publishes
the acquisition on and builds down to the last level whose pixel is no finer:
z16 on a 0.25 m DTM, z15 on 0.5 m, z14 on 1 m. Below the cell the service
resamples one height value into four pixels and RVT renders the interpolation as
if it were terrain.

**`-z` picks levels out of that ladder.** One (`-z 15`), a list (`-z 16,14,12`)
or an inclusive range written either way up (`-z 16-14`), always applied deepest
first. Levels are independent jobs, so this is how a pilot is run before the
rest and how one level is rebuilt without touching its neighbours. It builds
less, never deeper: a level finer than the acquisition's own DTM cell is refused
with the ladder that flight does earn, because that is the whole of what the
cell rule is for. Under `-c` there is no such limit — reading a level a file
holds is fair whatever it was built from.

**One number picks everything.** The footprint mask, the DEM request and the
database's name all come off it, which is what retires the one mistake the batch
could make silently: a mask paired with a project that never flew the ground it
points at returns all-NaN for every unit, writes no tile, and marks each one
done, leaving a file that looks built and is empty. Masks are derived on first
`-g` and cached beside the script as `coverage-<slug>.npz`; they, the snapshot
and `.venv/` are build artefacts, none committed.

A build resumes. The finished work units are a table in the same file, so a run
interrupted anywhere picks up where it stopped, and `--limit` is a pilot rather
than a prefix that has to be redone.

Building into a file that is already there adds levels to it, and two things
stop that. A file naming a *different* acquisition under a colliding slug is
refused outright — no amount of building fixes two acquisitions in one file. A
file built under a different **recipe** is refused unless `--force`, because
filling in its missing levels would leave one acquisition made of two kinds of
pixel. The recipe is every setting that decides a pixel, hashed; adding another
acquisition to a store does not change it, and editing `cvat.py` does.

## Copying it in

```
scp vestfold-10pkt-2025.mbtiles server:/site/tufteseid/data/cvat/
```

That is the deploy. No manifest to edit, no import step, nothing stopped and
nothing restarted: the acquisition is a row in the LiDAR dataset pulldown on the
next page load.

It works because the file says what it is. `metadata` carries the acquisition
name — byte-identical to the `LidarProject.id` the per-project WMS publishes,
which is what the app joins on — the levels written, and the recipe they were
written under. `cvat-tiles/server.mjs` surveys the store directory, reads that
out of each database, and answers `/cvat/manifest.json` with it. There is no
inventory beside the tiles that can disagree with them, and none to forget to
update. An acquisition departs the same way, by having its file deleted.

The sidecar keeps database handles open and re-surveys at most once every ten
seconds, dropping any handle whose file changed size or mtime underneath it — so
replacing a file in place is as safe as adding one, at the cost of up to ten
seconds of the old one.

**Audit before you ship.** `makevat.py -c <n>` reads every tile back and a copy
does not: a unit that never ran is the build host's problem, and far cheaper to
find there than after a night of rsync.

## What the store holds

```
.venv/bin/python vatcache.py -l                 the queue, and what is built
.venv/bin/python vatcache.py -l -v              the figures behind it
.venv/bin/python vatcache.py -l --all østfold   everything Kartverket flew
.venv/bin/python vatcache.py -c 7               audit one acquisition
.venv/bin/python vatcache.py -c                 audit the whole store
```

`--out` is the store and defaults to `/site/tufteseid/data/cvat`, the directory
`docker-compose.yml` bind-mounts read-only into the `cvat-tiles` sidecar.

`-l` reads the queue in `acquisitions.json` — the acquisitions judged worth
having, in the order they are worth having them — and annotates each row from
the databases actually present. Anything the store holds that is not on the
queue is appended, so an acquisition built off-list, or copied in from another
machine, can still be checked. `-v` additionally asks hoydedata.no and the
per-project WMS whether they still publish each name — the two ways an
acquisition fails are nothing to render and tiles nobody asks for, and both are
invisible from the store alone — and prints the ladder each one's cell size
earns.

**The two tools number differently and neither is wrong.** `makevat.py -l`
numbers the whole catalogue, 1 536 acquisitions in a snapshot of what Kartverket
flew; `vatcache.py -l` numbers the queue, which is a dozen. An index from one
means something else in the other, which is why `vatcache.py` hands a fault over
by *name* and tells you to look the number up.

## Checking a store

`-c` reads the `units` table, not the tiles, for what *should* be there: a work
unit the footprint merely clips can legitimately hold no tile, and only its
record separates that from a unit that never ran. It then decodes every tile
those units own — a full decode rather than a header read, because the failure
worth finding is truncation and a truncated WebP carries an intact header.
Around 5 ms a tile, so narrow it with `-z` when you only want one level. Without
`-z` each acquisition is read at the levels its own database says it holds, so a
0.5 m flight is not reported as missing the z16 it was never owed.

Both tools ask this same question of the same databases; `report.py` is the
answer, shared. `vatcache.py` asks it of the store the server serves,
`makevat.py` of a file that has not been copied anywhere yet.

What it reports, and what each means:

| Line | What happened |
| --- | --- |
| *n* units never built | the run stopped, or `--limit` cut it |
| *n* tiles do not decode | a blob that rotted; the app draws a broken image |
| *n* finished units outside the footprint | the mask or `--unit-tiles` changed since the run |
| *n* finished units hold no tile | the footprint edge — normal, unless it is *every* unit, which is the mask and the DEM being of different ground |
| *n* tiles belong to no finished unit | tiles in this acquisition's database that none of its finished units claims |

**Repair is `makevat.py -c <n> -g`**, wherever the file is — the store on the
server or a copy on the build host. `vatcache.py` reports and does not write,
because repairing means fetching DEM and rendering, which is the other tool's
whole job. Both kinds of damage are repaired the same way: delete the unit's
tiles, drop its record, let the build take it again. They go in one transaction,
and the tiles have to go at all because a rebuild that decides a tile is all-NaN
writes nothing there, so a broken tile left in place would outlive the repair
meant to clear it.

Orphan tiles are reported and never deleted. Reporting them is unambiguous now
that each acquisition owns a database; deleting them still is not, because the
reason one is there is usually a `--unit-tiles` that changed between runs.

There is no half-written tile to find. A unit's tiles and its record land in one
transaction, so the state the old `.part`-and-rename dance was guarding against
is not reachable.

## Several acquisitions in one store

Each owns a database, `<acquisition-slug>.mbtiles`. The slug is the filename and
nothing else: the sidecar reports it as that acquisition's `path` and the app
puts it in the tile template, so there is one copy of the slug rule and nowhere
for a second to drift from.

MBTiles as a container, not as a tileset a stranger can read: `tile_row` is the
spec's, counted from the south, but the grid under it is the app's own
EPSG:25833 one (`src/map/layers/wmsTileGrid.ts`), so a generic MBTiles reader
would hang these tiles somewhere in the Atlantic. `metadata` says as much.

**Overlap is the reason, and it is wanted.** Two flights over one landscape are
two readings of it — Vestfold og Telemark 5pkt 2021 and Vestfold 10pkt 2025 are
not the same ground twice — so the app offers both as rows in the LiDAR ring and
a reader can put one against the other. One namespace would have had them
overwrite each other's pixels, and a tile carries nothing that says who made it.

## The files

| File | What it does |
| --- | --- |
| `makevat.py` | The build: the numbered catalogue, one acquisition into one MBTiles file, and the repair of one. Runs anywhere, knows nothing about a store |
| `vatcache.py` | The store: the queue, what is in it, and the audit. Reports faults and hands them to `makevat.py` |
| `report.py` | Reading a built acquisition back — the figures, the levels a directory of databases holds, the audit and the orphan scan. Shared by both front ends |
| `acquisitions.py` | Acquisition identity: the queue, the published cell size that sets the ladder, and the two name sets — hoydedata's catalogue and the per-project WMS — that have to carry a name verbatim before its tiles reach a reader |
| `acquisitions.json` | The queue itself, in the order `vatcache.py -l` indexes. Committed, so it is a shared judgement about what is worth building rather than one machine's |
| `cvat.py` | RVT's combined VAT: the parameters out of `VAT_Combined.rft.xml`, and the layer walk out of `render_all_images`. The one module that decides what a pixel is |
| `build_tiles.py` | The store's geometry, the MBTiles container, a level built into it, and the audit that reads it back |
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
- **The ladder is z16 → z7** on the app's shared grid — the DTM is published at
  0.25 m, and z16 is 0.331 m/px. z16 to z12 is 3 764 / 941 / 313 / 116 / 46 work
  units of 4×4 tiles, z11 to z7 another 21 / 11 / 5 / 3 / 2. The quartering
  stops once a unit is wider than the flight — 347 km at z7 — after which a
  level costs only the one or two units its envelope straddles.
- **Compute is the constraint at z16 and nowhere else.** A work unit is the same
  2096 px square at every level, so it costs the same 11–13 s wherever it is,
  fetch included: ~12.5 core-hours for z16 against ~4.5 for z15 to z12 and
  minutes for everything below them.
- **Tiles are RGBA WebP q90.** An opaque alpha channel is free (0.339 B/px
  either way) and a half-covered tile is cheaper (0.153), so alpha is how
  no-data is stored rather than a grey that would look like ground. Below z12
  it is the acquisition's footprint mask instead: ImageServer answers a coarse
  request out of per-item overviews that fill the item's rectangle, so the DEM
  claims ground the flight never touched — half of a 21 km window at z8 for a
  0.17 km² ravine survey.
- **z15 → z7 is under a gigabyte; z16 is three times the rest together.**
  Measured over 40 z15 units: 0.280 B/px on fully covered tiles, 0.259 over
  covered ground, which puts z15 at 0.66 GB and z15 to z12 at ~0.9 GB against
  ~25 GB fetched; the same quartering five more times puts z11 to z7 in the
  single-digit megabytes. z16 quadruples the pixels at ~0.89 of the bytes each
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
`acquisitions.native_cells` asks it, `makevat.py` keeps the answer in its
snapshot, and the ladder comes off it whatever any list says.

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
store to: without the catalogue row there is no footprint to rank the cache by
and no envelope to cull with, so `resolveCvatAcquisitions` drops the acquisition
with a console warning and its tiles are never asked for. `makevat.py -l -v` and
both tools' `-c` check it.

To extend the queue, find candidates with `vatcache.py -l --all <substring>` or
`makevat.py -l <substring>` and write a row for each: `name` exactly as both
services spell it, plus `pkt`, `cell_m` and `where` for the reader. Only the
name has to be right — the ladder comes off the catalogue, not off the file, and
a row in `acquisitions.json` is a note about intent rather than anything a build
reads.
