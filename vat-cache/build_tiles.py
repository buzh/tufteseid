"""The tile store: its geometry, how a level is built into it, and how it is
verified afterwards. `vatcache.py` is the command line over all of it.

The store is what docker-compose bind-mounts into the cvat-tiles sidecar, so
what this writes is what the app serves.

One store holds several acquisitions, each in its own database:
`<slug>.mbtiles`, with the slug recorded in the manifest as the acquisition's
`path`. Overlap is the reason there is one per acquisition. Two flights over one
landscape are two pictures of it — a 5pkt from 2015 and a 10pkt from 2025 are
not the same ground twice — and the app offers both as rows, so their tiles
cannot be allowed to contend for one name.

Resumable: every work unit records itself when it finishes, and a re-run skips
the recorded ones. A unit that writes no tiles still records, because "the
footprint turned out not to reach here" and "never ran" are different states.
That is also why a check reads the `units` table rather than counting tiles:
only it can tell an edge unit that legitimately holds nothing from one that
never ran.

Each level is an independent job — its own fetch, its own scan, its own tiles —
so levels can be built in any order, or one rebuilt without the others. See
WORK-ORDER.md for why the radii are RVT's pixels rather than fixed metres, which
is what makes the levels independent in the first place.
"""

import hashlib
import json
import sqlite3
import sys
import time
import urllib.error
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

import cvat
import fetch_dem
from acquisitions import slug

# The app's shared tile grid, from src/map/layers/wmsTileGrid.ts: resolutions are
# max(EPSG:25833 extent span) / 256 / 2**z and the origin is the extent's
# top-left corner. Tiles are 512 px there and have to be 512 px here.
GRID_ORIGIN = (-2500000.0, 9045984.0)
MAX_RESOLUTION = 21664.0
TILE_PX = 512

# Enough for the largest max_rad RVT asks for (flat, 20 px) plus the 3x3 window
# the gradients read. In pixels, so it scales with the level the same way the
# radii do.
OVERLAP_PX = 24

# 4 x 512 + 2 x 24 = 2096 px, about 18 MB of float32 per call. exportImage caps
# at 15000, so the only reason not to go bigger is that a unit the footprint
# merely clips is fetched whole.
DEFAULT_UNIT_TILES = 4
# Every level the store can hold, deepest first. What one acquisition is built
# to is `levels_for` its own DTM, not this: z16 on a 0.5 m flight would render
# the interpolation between cells.
DEFAULT_LEVELS = (16, 15, 14, 13, 12)
COARSEST_LEVEL = 12
WEBP_QUALITY = 90


def resolution(z):
    return MAX_RESOLUTION / 2**z


def levels_for(native_cell):
    """The ladder for a DTM of this cell size: as deep as the grid the data is
    published on supports, and never deeper.

    A level is worth building while its pixel is no finer than the DEM's own
    cell — z16 (0.331 m/px) on Kartverket's 0.25 m grid, z15 (0.661 m/px) on the
    0.5 m one. Below that the fetch resamples one height value into four pixels
    and RVT reads the interpolation as terrain."""
    z = COARSEST_LEVEL
    while z < DEFAULT_LEVELS[0] and resolution(z + 1) >= native_cell:
        z += 1
    return tuple(range(z, COARSEST_LEVEL - 1, -1))


def tile_span(z):
    return TILE_PX * resolution(z)


def unit_bbox(z, ux, uy, unit_tiles):
    """EPSG:25833 (west, south, east, north) of one work unit, tiles included."""
    side = tile_span(z) * unit_tiles
    west = GRID_ORIGIN[0] + ux * side
    north = GRID_ORIGIN[1] - uy * side
    return west, north - side, west + side, north


class Coverage:
    """The acquisition's footprint union, as coverage.py rasterised it."""

    def __init__(self, path):
        data = np.load(path)
        self.mask = data["mask"]
        self.x0, self.x1, self.y0, self.y1 = (float(v) for v in data["bounds"])
        self.cell = float(data["cell"])
        # Which acquisition this mask is of. coverage.py stamps it so that a run
        # cannot pair one acquisition's footprint with another's DEM: that pins
        # the fetch to a project which never flew the ground the mask points at,
        # so every unit comes back all-NaN, writes nothing, and marks itself
        # done. Files written before the stamp existed carry None.
        self.project = str(data["project"]) if "project" in data.files else None

    def reaches(self, west, south, east, north):
        if east <= self.x0 or west >= self.x1 or north <= self.y0 or south >= self.y1:
            return False
        i0 = max(0, int((west - self.x0) / self.cell))
        i1 = min(self.mask.shape[1], int(np.ceil((east - self.x0) / self.cell)))
        j0 = max(0, int((south - self.y0) / self.cell))
        j1 = min(self.mask.shape[0], int(np.ceil((north - self.y0) / self.cell)))
        if i1 <= i0 or j1 <= j0:
            return False
        return bool(self.mask[j0:j1, i0:i1].any())

    def units(self, z, unit_tiles):
        """Every unit of this level the footprint reaches, in reading order."""
        side = tile_span(z) * unit_tiles
        ux0 = int(np.floor((self.x0 - GRID_ORIGIN[0]) / side))
        ux1 = int(np.floor((self.x1 - GRID_ORIGIN[0]) / side))
        uy0 = int(np.floor((GRID_ORIGIN[1] - self.y1) / side))
        uy1 = int(np.floor((GRID_ORIGIN[1] - self.y0) / side))
        out = []
        for uy in range(uy0, uy1 + 1):
            for ux in range(ux0, ux1 + 1):
                if self.reaches(*unit_bbox(z, ux, uy, unit_tiles)):
                    out.append((ux, uy))
        return out


def fetch_unit(z, ux, uy, unit_tiles, project, attempts=5, delay=2.0):
    """The unit's DEM, grown by the overlap, at the level's own resolution."""
    res = resolution(z)
    west, south, east, north = unit_bbox(z, ux, uy, unit_tiles)
    grow = OVERLAP_PX * res
    side_m = (east - west) + 2 * grow
    px = unit_tiles * TILE_PX + 2 * OVERLAP_PX
    cx, cy = (west + east) / 2, (south + north) / 2
    for attempt in range(attempts):
        try:
            return fetch_dem.fetch(cx, cy, side_m, px, project=project)
        except (urllib.error.URLError, RuntimeError, ValueError, TimeoutError):
            if attempt == attempts - 1:
                raise
            # The service answers a burst with a text body rather than a status,
            # which arrives here as RuntimeError; backing off is the only cure.
            time.sleep(delay * 2**attempt)


def encode_tile(field):
    """One 512 px tile of the 0..1 composite -> WebP bytes, or None if no ground.

    Grey is RVT's own quantisation; alpha is coverage. byte_scale paints NaN
    white, which is a constant under a transparent alpha and so costs nothing.
    """
    covered = ~np.isnan(field)
    if not covered.any():
        return None
    grey = cvat.byte_scale(field, c_min=0, c_max=1)
    alpha = np.where(covered, 255, 0).astype(np.uint8)
    band = Image.fromarray(grey)
    image = Image.merge("RGBA", (band, band, band, Image.fromarray(alpha)))
    buf = BytesIO()
    image.save(buf, "WEBP", quality=WEBP_QUALITY)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# The store
# ---------------------------------------------------------------------------

STORE_SUFFIX = ".mbtiles"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS tiles (
    zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
CREATE UNIQUE INDEX IF NOT EXISTS tile_index
    ON tiles (zoom_level, tile_column, tile_row);
CREATE TABLE IF NOT EXISTS units (
    zoom_level INTEGER, unit_x INTEGER, unit_y INTEGER,
    PRIMARY KEY (zoom_level, unit_x, unit_y));
"""


def store_path(out, project):
    """The acquisition's own database. Its stem is what the manifest hands the
    app as `path`, so the slug rule lives in one place and the app's tile
    template needs to know nothing about the container."""
    return Path(out) / f"{slug(project)}{STORE_SUFFIX}"


def tiles_per_side(z):
    """How many tiles the grid holds across at this level.

    The EPSG:25833 extent is square and 256 tiles of 512 px wide at z9, so it
    is 2**(z-1) — which is the figure the row flip below needs and the one
    thing the grid's own module does not spell out."""
    return 2 ** (z - 1)


def tms_row(z, y):
    """The store's row for the app's y, and back again — MBTiles counts rows
    from the south, the app's grid from the north. Its own inverse, which is
    why the reader (`cvat-tiles/server.mjs`) can apply the same formula."""
    return tiles_per_side(z) - 1 - y


def unit_rect(z, ux, uy, unit_tiles):
    """The (column, row) rectangle one work unit owns, in the store's own
    coordinates: first and last column, first and last row. The rows come out
    the other way up from the y range, hence the swap."""
    x0, y0 = ux * unit_tiles, uy * unit_tiles
    return (x0, x0 + unit_tiles - 1,
            tms_row(z, y0 + unit_tiles - 1), tms_row(z, y0))


class Store:
    """One acquisition's tiles, in one SQLite database.

    MBTiles as a container, not as a tileset a stranger can read: the rows are
    the spec's, but the grid under them is EPSG:25833 (`wmsTileGrid.ts`), so a
    generic reader would hang these tiles somewhere in the Atlantic. The
    manifest beside the databases and `cvat-tiles/server.mjs` are the readers,
    and both know the grid.

    Left in the default journal mode on purpose. WAL wants to write two files
    beside the database, which a read-only opener cannot do — and the sidecar
    holds these open read-only while a batch run appends to them. A unit is one
    transaction every eleven seconds, so there is nothing here to tune.
    """

    def __init__(self, path, write=False):
        self.path = Path(path)
        if write:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.db = sqlite3.connect(self.path, timeout=30)
            self.db.executescript(_SCHEMA)
        else:
            self.db = sqlite3.connect(f"file:{self.path}?mode=ro",
                                      uri=True, timeout=30)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        self.db.close()

    def stamp(self, project):
        """What the file is, for whoever opens it with sqlite3 rather than
        through the app. Nothing in the stack reads these rows — the manifest
        is the authority on the recipe — but a database that cannot say what
        it holds is a liability in a directory of nine of them."""
        span = self.db.execute(
            "SELECT min(zoom_level), max(zoom_level) FROM tiles").fetchone()
        rows = {
            "name": project,
            "format": "webp",
            "type": "overlay",
            "version": "1",
            "crs": "EPSG:25833",
            "description": (
                "RVT combined VAT over hoydedata.no DTM. Grid is the app's "
                "own (src/map/layers/wmsTileGrid.ts): 512 px tiles, origin "
                "north-west, resolution 21664 / 2**z. tile_row is TMS, "
                "2**(z-1) - 1 - y. See manifest.json beside this file."),
        }
        if span[0] is not None:
            rows["minzoom"], rows["maxzoom"] = str(span[0]), str(span[1])
        with self.db:
            self.db.executemany(
                "INSERT INTO metadata (name, value) VALUES (?, ?) "
                "ON CONFLICT(name) DO UPDATE SET value = excluded.value",
                list(rows.items()))

    def units(self, z):
        """The units finished at this level."""
        return {
            (ux, uy) for ux, uy in self.db.execute(
                "SELECT unit_x, unit_y FROM units WHERE zoom_level = ?", (z,))
        }

    def tiles_in(self, z, ux, uy, unit_tiles):
        """(x, y, blob) for every tile this work unit holds."""
        x0, x1, r0, r1 = unit_rect(z, ux, uy, unit_tiles)
        rows = self.db.execute(
            "SELECT tile_column, tile_row, tile_data FROM tiles "
            "WHERE zoom_level = ? AND tile_column BETWEEN ? AND ? "
            "AND tile_row BETWEEN ? AND ?", (z, x0, x1, r0, r1))
        return [(x, tms_row(z, row), blob) for x, row, blob in rows]

    def coords(self, z):
        """Every tile coordinate at this level, whatever unit it belongs to."""
        return {
            (x, tms_row(z, row)) for x, row in self.db.execute(
                "SELECT tile_column, tile_row FROM tiles WHERE zoom_level = ?",
                (z,))
        }

    def _put(self, z, tiles):
        """The insert itself, in whatever transaction the caller has open."""
        self.db.executemany(
            "INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(zoom_level, tile_column, tile_row) "
            "DO UPDATE SET tile_data = excluded.tile_data",
            [(z, x, tms_row(z, y), blob) for x, y, blob in tiles])

    def write_tiles(self, z, tiles):
        """Tiles with no claim to being a finished unit — what `pack_store.py`
        has for a tile that was on disk under no marker."""
        with self.db:
            self._put(z, tiles)

    def write_unit(self, z, ux, uy, tiles):
        """One work unit's tiles and its record of being finished, in one
        transaction.

        Together, because the record is what declares the unit done: a kill
        between the two would leave a unit that reads as built and is not. That
        is the whole of what the old write-to-`.part`-and-rename dance bought,
        and the transaction buys it for the unit rather than for one tile."""
        with self.db:
            self._put(z, tiles)
            self.db.execute(
                "INSERT OR IGNORE INTO units (zoom_level, unit_x, unit_y) "
                "VALUES (?, ?, ?)", (z, ux, uy))

    def drop_units(self, z, units, unit_tiles):
        """Hand these units back to the build, tiles and record together."""
        with self.db:
            for ux, uy in units:
                x0, x1, r0, r1 = unit_rect(z, ux, uy, unit_tiles)
                self.db.execute(
                    "DELETE FROM tiles WHERE zoom_level = ? "
                    "AND tile_column BETWEEN ? AND ? AND tile_row BETWEEN ? AND ?",
                    (z, x0, x1, r0, r1))
                self.db.execute(
                    "DELETE FROM units WHERE zoom_level = ? AND unit_x = ? "
                    "AND unit_y = ?", (z, ux, uy))


def read_store(out, project):
    """This acquisition's database open read-only, or None where the store
    holds none of it. Read-only so that asking a question of a store — how far
    a build got, what a level holds — cannot create one."""
    path = store_path(out, project)
    return Store(path) if path.exists() else None


def build_unit(args):
    """Fetch and render one work unit. Runs in a worker process.

    Returns its tiles rather than writing them: the store is one database per
    acquisition, and the parent is its only writer. A few megabytes back over
    the pipe per eleven seconds of render."""
    z, ux, uy, unit_tiles, project = args
    res = resolution(z)
    dem = fetch_unit(z, ux, uy, unit_tiles, project)
    # radius_in_metres=False: RVT's max_rad as written, so this level is RVT's
    # combined VAT of its own grid.
    composite = cvat.cvat(dem, res, radius_in_metres=False)
    inner = composite[OVERLAP_PX:-OVERLAP_PX, OVERLAP_PX:-OVERLAP_PX]

    tiles = []
    for j in range(unit_tiles):
        for i in range(unit_tiles):
            tile = inner[j * TILE_PX:(j + 1) * TILE_PX, i * TILE_PX:(i + 1) * TILE_PX]
            blob = encode_tile(tile)
            if blob is not None:
                tiles.append((ux * unit_tiles + i, uy * unit_tiles + j, blob))
    return z, ux, uy, tiles


def settings(levels, unit_tiles):
    """The recipe: everything that decides what a pixel is, given ground to read.
    The digest of this, minus the per-level entries, is what makes a cache built
    under changed settings declare itself a different one — see `open_manifest`.

    Which acquisitions the store covers is deliberately not in here. The recipe
    is what has to agree between runs; the acquisitions are what accumulate."""
    from importlib.metadata import version

    return {
        "generator": "vat-cache/build_tiles.py",
        "renderer": f"rvt-py {version('rvt-py')}",
        "source": "hoydedata.no Prosjekt_DTM exportImage, pixelType=F32",
        "visualization": "RVT combined VAT (VAT_Combined.rft.xml)",
        "presets": cvat.VAT_PRESETS,
        "blend_order": ["Hillshade normal 100", "Slope luminosity 50",
                        "Openness+ overlay 50", "Sky-View multiply 25"],
        "overlay_opacity_note": (
            "rvt.blend_func.blend_overlay writes through its background, so the "
            "openness layer's 50 % performs as 100 %. That is RVT's own "
            "behaviour and is deliberately not corrected."),
        "sun_azimuth": cvat.SUN_AZIMUTH,
        "n_directions": cvat.N_DIRECTIONS,
        "ve_factor": cvat.VE_FACTOR,
        "combined_opacity": cvat.COMBINED_OPACITY,
        "radius_rule": "RVT max_rad in pixels, verbatim at every level",
        "grid": {
            "projection": "EPSG:25833",
            "origin": list(GRID_ORIGIN),
            "tile_px": TILE_PX,
            "max_resolution": MAX_RESOLUTION,
            "note": "src/map/layers/wmsTileGrid.ts; resolution = max_resolution / 2**z",
        },
        "encoding": f"RGBA WebP q{WEBP_QUALITY}, alpha is coverage",
        # In the digest, though it decides nothing about a pixel: a store of
        # loose files and a store of databases are not one store, and a build
        # that opened the wrong one would write a second copy of the ground
        # beside the first. The recipe check is the guard that already exists.
        "container": ("MBTiles (SQLite) per acquisition, <path>.mbtiles; "
                      "tile_row is TMS, 2**(z-1) - 1 - y"),
        "overlap_px": OVERLAP_PX,
        "unit_tiles": unit_tiles,
        "levels": {
            str(z): {
                "m_per_px": round(resolution(z), 6),
                "tile_m": round(tile_span(z), 3),
                "overlap_m": round(OVERLAP_PX * resolution(z), 3),
                "radii": cvat.radii_for(resolution(z), radius_in_metres=False),
            }
            for z in levels
        },
    }


def _digest(recipe, acquisition=None):
    """Digest of the recipe, over everything except `levels`. Which levels one
    invocation builds is not a property of the cache: a level's entry is derived
    from z and the settings above it, and levels arrive one run at a time, so a
    store holding z15 has to accept the run that adds z14. Acquisitions
    accumulate the same way and for the same reason, so they are not in here.

    `acquisition` reproduces the digest of a manifest from when a store held
    exactly one, which is how `open_manifest` recognises that shape as the same
    recipe rather than a changed one."""
    body = {k: v for k, v in recipe.items() if k != "levels"}
    if acquisition is not None:
        body["acquisition"] = acquisition
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:16]


def manifest_agrees(have, unit_tiles):
    """Was this manifest written under the recipe this code computes?

    The levels passed to `settings` are immaterial — the digest is over
    everything but them — so this is answerable without knowing what a run
    intends to build, which is what lets a migration ask it up front."""
    recipe = settings([COARSEST_LEVEL], unit_tiles)
    digest = _digest(recipe)
    # A manifest from when a store held exactly one acquisition carried it
    # inside the digest. Same recipe, older shape.
    single = have.get("acquisition") if "acquisitions" not in have else None
    return have.get("digest") in (
        digest, _digest(recipe, single) if single else None)


def open_manifest(out, project, levels, unit_tiles, force):
    """Write the manifest, or check the one already there agrees with this run."""
    recipe = settings(levels, unit_tiles)
    digest = _digest(recipe)
    path = Path(out) / "manifest.json"

    # What ground is in the store, where its tiles are, and at which levels. Per
    # acquisition, because a level built for one is not built for another: a
    # reader asking "is z12 here for Østfold" must not be answered by Vestfold's
    # z12. `path` is the app's tile template and the database's own stem, so the
    # slug rule lives here alone and no second implementation of it can drift.
    entry = {"levels": sorted(levels, reverse=True), "path": slug(project)}
    acquisitions = {project: entry}

    if path.exists():
        have = json.loads(path.read_text())
        # A manifest from when a store held exactly one acquisition carried it
        # inside the digest. Same recipe, older shape: migrate it rather than
        # making the operator reach for --force, which would equally have waved
        # through a recipe that really had changed.
        legacy = "acquisitions" not in have and "acquisition" in have
        if not manifest_agrees(have, unit_tiles) and not force:
            # The likeliest reason today is a store of loose tile files, which
            # this code can no longer write into. That one has a repair rather
            # than a decision, so name it.
            packable = "container" not in have
            sys.exit(
                f"{path} was built under different settings "
                f"(digest {have.get('digest')}, this run {digest}).\n"
                + ("This store holds loose tile files. Pack it first:\n"
                   f"  python pack_store.py {out} --apply\n"
                   if packable else
                   "A cache mixing two settings cannot say what it is. Build "
                   "into an empty directory, or pass --force if you know why.")
            )
        # Levels arrive one run at a time; keep the ones already built.
        recipe["levels"] = {**have.get("levels", {}), **recipe["levels"]}
        # Same for acquisitions, and for each one the union of its levels. The
        # legacy shape's single acquisition owns whatever levels the store had.
        merged = dict(have.get("acquisitions", {}))
        if legacy:
            merged.setdefault(have["acquisition"], {"levels": sorted(
                (int(z) for z in have.get("levels", {})), reverse=True)})
        was = merged.get(project, {}).get("levels", [])
        merged[project] = {**entry, "levels": sorted(set(was) | set(levels),
                                                     reverse=True)}
        # Entries written before the store was divided per acquisition carry no
        # path, and the app drops those rather than guessing at a template. Any
        # run repairs every one of them, because the slug is a pure function of
        # the name — which is why moving an old store's levels under its slug is
        # the whole migration.
        for name, was_entry in merged.items():
            merged[name] = {**was_entry, "path": slug(name)}
        acquisitions = merged

    wanted = {**recipe, "digest": digest, "acquisitions": acquisitions}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(wanted, indent=2, sort_keys=True))
    return digest


def marked_units(out, project, z):
    """The units this acquisition has finished at this level.

    Per acquisition, for the same reason the tiles are: overlap is expected and
    wanted, so two acquisitions can own the same work unit and the same tile
    coordinates inside it. Vestfold 10pkt 2025 lies almost wholly on top of
    Vestfold og Telemark 5pkt 2021, and one's record must not tell the other
    that its tiles are written. Cheap enough to ask for a progress figure
    without a mask at hand."""
    store = read_store(out, project)
    if store is None:
        return set()
    with store:
        return store.units(z)


def build(out, project, coverage, levels, unit_tiles=DEFAULT_UNIT_TILES,
          jobs=1, limit=None, dry_run=False, force=False):
    """Build the named levels for one acquisition, skipping finished units."""
    out = Path(out)

    # The mask and the DEM have to be of the same ground. Pairing them wrongly
    # is not loud: the fetch is pinned to a project that never flew there, every
    # unit comes back all-NaN, nothing is written, and every unit marks itself
    # done — a store that looks built and is empty. vatcache.py derives the mask
    # from the acquisition so the two cannot drift, but a mask written by hand
    # still reaches here.
    if coverage.project != project:
        sys.exit(
            f"the mask is the footprint of {coverage.project!r}, but the "
            f"acquisition is {project!r}.\nOne of the two is wrong; they have "
            "to name the same ground."
        )

    store = None
    if not dry_run:
        digest = open_manifest(out, project, levels, unit_tiles, force)
        print(f"{out}  manifest {digest}  {project}")
        store = Store(store_path(out, project), write=True)
        store.stamp(project)

    try:
        for z in levels:
            units = coverage.units(z, unit_tiles)
            done = store.units(z) if store else marked_units(out, project, z)
            pending = [u for u in units if u not in done]
            side_km = tile_span(z) * unit_tiles / 1000
            print(f"\nz{z}  {resolution(z):.4f} m/px  unit {side_km:.2f} km  "
                  f"{len(units)} units, {len(pending)} to do")
            if dry_run:
                continue
            if limit:
                pending = pending[:limit]
            if not pending:
                continue

            started, tiles = time.perf_counter(), 0
            work = [(z, ux, uy, unit_tiles, project) for ux, uy in pending]
            if jobs > 1:
                with ProcessPoolExecutor(max_workers=jobs) as pool:
                    futures = {pool.submit(build_unit, w): w for w in work}
                    for finished, future in enumerate(as_completed(futures), 1):
                        _z, ux, uy, made = future.result()
                        store.write_unit(z, ux, uy, made)
                        tiles += len(made)
                        report(finished, len(work), tiles, started)
            else:
                for finished, item in enumerate(work, 1):
                    _z, ux, uy, made = build_unit(item)
                    store.write_unit(z, ux, uy, made)
                    tiles += len(made)
                    report(finished, len(work), tiles, started)
            print()
    finally:
        if store:
            # Again at the end, for the level span: the first stamp was written
            # before this run's tiles were.
            store.stamp(project)
            store.close()


def report(done, total, tiles, started):
    elapsed = time.perf_counter() - started
    rate = elapsed / done
    print(f"\r  {done}/{total} units, {tiles} tiles, {rate:.1f} s/unit, "
          f"{(total - done) * rate / 3600:.1f} h left", end="", flush=True)


# ---------------------------------------------------------------------------
# Verifying what is there
# ---------------------------------------------------------------------------


@dataclass
class LevelCheck:
    """What one level of one acquisition holds, against what the mask says it
    should.

    `todo` and `broken` are repaired the same way — hand the unit back to the
    build — and are counted apart only because they say different things about
    the run that produced them: one never finished, the other stored bytes the
    app cannot draw."""

    z: int
    unit_tiles: int = DEFAULT_UNIT_TILES
    units: int = 0
    done: int = 0
    tiles: int = 0
    bytes: int = 0
    empty: int = 0
    todo: list = field(default_factory=list)
    broken: list = field(default_factory=list)
    stray: list = field(default_factory=list)

    @property
    def ok(self):
        return not (self.todo or self.broken)

    @property
    def repairable(self):
        """Units to hand back: the unbuilt ones, plus the ones holding a tile
        that does not decode."""
        hurt = {unit_of(t, self.unit_tiles) for t in self.broken}
        return sorted(set(self.todo) | hurt)


def unit_of(tile, unit_tiles):
    """Which work unit a tile belongs to. The inverse of the division
    `build_unit` makes."""
    x, y = tile
    return x // unit_tiles, y // unit_tiles


def readable_tile(blob):
    """Does this decode to a tile a browser will draw?

    A full decode rather than a header read, because the failure worth finding
    is truncation and a truncated WebP carries an intact header. A unit's tiles
    land in one transaction, so a half-written tile is no longer reachable —
    which is what makes this worth asking: what it can still find is a blob
    that rotted under the filesystem, not a run that was killed. ~5 ms a tile,
    so a whole level is a minute or two."""
    try:
        with Image.open(BytesIO(blob)) as image:
            image.load()
            return image.size == (TILE_PX, TILE_PX)
    except Exception:
        # Anything Pillow raises on is an image the app cannot draw. Which of
        # its half-dozen exception types it was does not change the repair.
        return False


def check_level(out, project, coverage, z, unit_tiles=DEFAULT_UNIT_TILES,
                progress=None):
    """Read one level of one acquisition out of the store and tally it against
    the mask.

    The `units` table is the authority on what should be there, not the mask
    alone: a unit the footprint merely clips can legitimately hold no tile at
    all, and only its record separates that from a unit that never ran."""
    result = LevelCheck(z=z, unit_tiles=unit_tiles)
    units = coverage.units(z, unit_tiles)
    result.units = len(units)

    store = read_store(out, project)
    try:
        marked = store.units(z) if store else set()
        # A unit the footprint does not reach: the mask was rebuilt, or
        # --unit-tiles changed between runs. Harmless in itself, but it means
        # the store and the mask no longer describe the same division.
        result.stray = sorted(marked - set(units))

        for seen, (ux, uy) in enumerate(units, 1):
            if progress:
                progress(seen, len(units))
            if (ux, uy) not in marked:
                result.todo.append((ux, uy))
                continue
            here = 0
            for x, y, blob in store.tiles_in(z, ux, uy, unit_tiles):
                here += 1
                result.bytes += len(blob)
                if not readable_tile(blob):
                    result.broken.append((x, y))
            result.tiles += here
            # A finished unit holding nothing is the footprint clipping its
            # corner, normal at the edge. Every unit empty is the wrong-project
            # trap.
            if here == 0:
                result.empty += 1
    finally:
        if store:
            store.close()
    result.done = len(units) - len(result.todo)
    return result


def unmark(out, project, z, units, unit_tiles=DEFAULT_UNIT_TILES):
    """Hand these units back to the build. Their tiles go with them: a rebuild
    that decides a tile is all-NaN writes nothing there, so a broken tile left
    in place would outlive the repair meant to clear it."""
    path = store_path(out, project)
    if not path.exists():
        return
    with Store(path, write=True) as store:
        store.drop_units(z, units, unit_tiles)


def store_tiles(out, project, z):
    """Every tile in the store at this level of this acquisition — including
    the ones no finished unit claims, which is what makes it worth reading from
    the tiles table rather than deriving from the units one."""
    store = read_store(out, project)
    if store is None:
        return set()
    with store:
        return store.coords(z)


def tiles_under(units, unit_tiles):
    """The tile coordinates a set of work units covers."""
    return {
        (ux * unit_tiles + i, uy * unit_tiles + j)
        for ux, uy in units
        for j in range(unit_tiles)
        for i in range(unit_tiles)
    }
