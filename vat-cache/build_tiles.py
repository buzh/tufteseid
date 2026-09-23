"""One acquisition's tiles: the geometry, how a level is built, and how it is
verified afterwards. `makevat.py` builds over this and `vatcache.py` audits.

One acquisition is one database, `<slug>.mbtiles`, carrying its own name, levels
and recipe in `metadata`; a store is a directory of them and the cvat-tiles
sidecar derives `/cvat/manifest.json` by reading the files.

Resumable: every work unit records itself in `units` when it finishes, including
units that wrote no tiles, so a check can tell an edge unit that legitimately
holds nothing from one that never ran. Each level is an independent job.
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

# The app's shared tile grid, from src/map/layers/wmsTileGrid.ts: resolution is
# max(EPSG:25833 extent span) / 256 / 2**z, origin the extent's top-left corner,
# tiles 512 px.
GRID_ORIGIN = (-2500000.0, 9045984.0)
MAX_RESOLUTION = 21664.0
TILE_PX = 512

# RVT's largest max_rad (flat, 20 px) plus the gradients' 3x3 window.
OVERLAP_PX = 24

# 4 x 512 + 2 x 24 = 2096 px, ~18 MB of float32 per call; exportImage caps at 15000.
DEFAULT_UNIT_TILES = 4
# Every level the store can hold, deepest first; one acquisition builds
# `levels_for` its own DTM, not all of these.
DEFAULT_LEVELS = (16, 15, 14, 13, 12, 11, 10, 9, 8, 7)
COARSEST_LEVEL = 7
WEBP_QUALITY = 90

# Below this level a tile's alpha is the footprint, not the DEM's no-data:
# ImageServer answers coarse requests out of per-mosaic-item overviews that fill
# the item's whole rectangle, so a coarse window returns ground never flown.
MASK_ALPHA_BELOW_Z = 12


def resolution(z):
    return MAX_RESOLUTION / 2**z


def levels_for(native_cell):
    """The ladder for a DTM of this cell size, deepest level first.

    A level is worth building while its pixel is no finer than the DEM's cell:
    z16 (0.331 m/px) on a 0.25 m grid, z15 (0.661 m/px) on a 0.5 m one. The
    coarse end is fixed at z7, which feeds `src/map/cvatHintLayer.ts`."""
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
        self.path = str(path)
        data = np.load(path)
        self.mask = data["mask"]
        self.x0, self.x1, self.y0, self.y1 = (float(v) for v in data["bounds"])
        self.cell = float(data["cell"])
        # Which acquisition the mask is of; None in files written before the
        # stamp existed.
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

    def sample(self, west, south, east, north, px):
        """The footprint over one square, as a north-up (px, px) boolean.

        Pixel coarser than the 25 m mask cell: every set cell claims the pixel it
        lands in, so a flight narrower than a pixel survives. Pixel finer: read
        the cell the pixel's centre is in."""
        out = np.zeros((px, px), bool)
        pixel = (east - west) / px
        if pixel >= self.cell:
            jj, ii = np.nonzero(self.mask)
            if jj.size == 0:
                return out
            cx = (self.x0 + (ii + 0.5) * self.cell - west) // pixel
            cy = (north - self.y0 - (jj + 0.5) * self.cell) // pixel
            keep = (cx >= 0) & (cx < px) & (cy >= 0) & (cy < px)
            out[cy[keep].astype(int), cx[keep].astype(int)] = True
            return out
        step = (np.arange(px) + 0.5) * pixel
        i = ((west + step - self.x0) // self.cell).astype(int)
        j = ((north - step - self.y0) // self.cell).astype(int)
        gi = (i >= 0) & (i < self.mask.shape[1])
        gj = (j >= 0) & (j < self.mask.shape[0])
        out[np.ix_(gj, gi)] = self.mask[np.ix_(j[gj], i[gi])]
        return out

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
            # which arrives here as RuntimeError.
            time.sleep(delay * 2**attempt)


def encode_tile(field, footprint=None):
    """One 512 px tile of the 0..1 composite -> WebP bytes, or None if no ground.

    Grey is RVT's byte_scale (NaN -> white); alpha is coverage."""
    covered = ~np.isnan(field)
    if footprint is not None:
        covered &= footprint
    if not covered.any():
        return None
    grey = cvat.byte_scale(field, c_min=0, c_max=1)
    alpha = np.where(covered, 255, 0).astype(np.uint8)
    band = Image.fromarray(grey)
    image = Image.merge("RGBA", (band, band, band, Image.fromarray(alpha)))
    buf = BytesIO()
    image.save(buf, "WEBP", quality=WEBP_QUALITY)
    return buf.getvalue()


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
    """The acquisition's own database; its stem is the `path` the sidecar
    publishes to the app."""
    return Path(out) / f"{slug(project)}{STORE_SUFFIX}"


def tiles_per_side(z):
    """Tiles across the grid at this level. The EPSG:25833 extent is square and
    256 tiles of 512 px wide at z9, so 2**(z-1)."""
    return 2 ** (z - 1)


def tms_row(z, y):
    """The store's row for the app's y, and back — MBTiles counts rows from the
    south, the app's grid from the north. Its own inverse, as in
    `cvat-tiles/server.mjs`."""
    return tiles_per_side(z) - 1 - y


def unit_rect(z, ux, uy, unit_tiles):
    """The (first column, last column, first row, last row) one work unit owns,
    in store coordinates. Rows come out the other way up from y, hence the swap."""
    x0, y0 = ux * unit_tiles, uy * unit_tiles
    return (x0, x0 + unit_tiles - 1,
            tms_row(z, y0 + unit_tiles - 1), tms_row(z, y0))


class Store:
    """One acquisition's tiles, in one SQLite database.

    MBTiles as a container only: the rows follow the spec but the grid under them
    is EPSG:25833 (`wmsTileGrid.ts`), so only `cvat-tiles/server.mjs` can place
    them. Keep the default journal mode — WAL writes two files beside the
    database, which the sidecar's read-only opener cannot do.
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

    def levels(self):
        """Which levels this database holds, deepest first, read from the tiles."""
        return [z for (z,) in self.db.execute(
            "SELECT DISTINCT zoom_level FROM tiles ORDER BY zoom_level DESC")]

    def meta(self, key):
        """One row of the stamp, or None."""
        row = self.db.execute(
            "SELECT value FROM metadata WHERE name = ?", (key,)).fetchone()
        return row[0] if row else None

    def stamp(self, project, recipe=None):
        """Write the metadata rows the sidecar derives `/cvat/manifest.json` from.

        `name` must be byte-identical to hoydedata's catalogue and to the
        `LidarProject.id` the per-project WMS publishes; that is what the app
        joins on. `recipe` is provenance and no code reads it."""
        span = self.db.execute(
            "SELECT min(zoom_level), max(zoom_level) FROM tiles").fetchone()
        levels = self.levels()
        rows = {
            "name": project,
            "format": "webp",
            "type": "overlay",
            "version": "1",
            "crs": "EPSG:25833",
            "levels": json.dumps(levels),
            "description": (
                "RVT combined VAT over hoydedata.no DTM. Grid is the app's "
                "own (src/map/layers/wmsTileGrid.ts): 512 px tiles, origin "
                "north-west, resolution 21664 / 2**z. tile_row is TMS, "
                "2**(z-1) - 1 - y. The `recipe` row is what made the pixels."),
        }
        if span[0] is not None:
            rows["minzoom"], rows["maxzoom"] = str(span[0]), str(span[1])
        if recipe is not None:
            # The digested body, so `digest` is sha256 of `recipe` and a reader
            # can check one against the other.
            rows["recipe"] = json.dumps(
                {k: v for k, v in recipe.items() if k != "levels"},
                sort_keys=True)
            rows["digest"] = recipe_digest(recipe)
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

    def write_unit(self, z, ux, uy, tiles):
        """One work unit's tiles and its record of being finished, in one
        transaction: the record is what declares the unit done, so a kill between
        the two would leave a unit that reads as built and is not."""
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
    """This acquisition's database open read-only, or None if it does not exist.
    Read-only so that asking a question of a store cannot create one."""
    path = store_path(out, project)
    return Store(path) if path.exists() else None


_MASKS = {}


def worker_coverage(path):
    """The footprint, read once per worker process rather than sent per unit."""
    if path not in _MASKS:
        _MASKS[path] = Coverage(path)
    return _MASKS[path]


def build_unit(args):
    """Fetch and render one work unit. Runs in a worker process, and returns its
    tiles rather than writing them: the parent is the database's only writer."""
    z, ux, uy, unit_tiles, project, coverage_path = args
    res = resolution(z)
    dem = fetch_unit(z, ux, uy, unit_tiles, project)
    # radius_in_metres=False: RVT's max_rad as written, so this level is RVT's
    # combined VAT of its own grid.
    composite = cvat.cvat(dem, res, radius_in_metres=False)
    inner = composite[OVERLAP_PX:-OVERLAP_PX, OVERLAP_PX:-OVERLAP_PX]
    footprint = (
        worker_coverage(coverage_path).sample(
            *unit_bbox(z, ux, uy, unit_tiles), unit_tiles * TILE_PX)
        if z < MASK_ALPHA_BELOW_Z else None
    )

    tiles = []
    for j in range(unit_tiles):
        for i in range(unit_tiles):
            rows = slice(j * TILE_PX, (j + 1) * TILE_PX)
            cols = slice(i * TILE_PX, (i + 1) * TILE_PX)
            tile = inner[rows, cols]
            blob = encode_tile(
                tile, None if footprint is None else footprint[rows, cols])
            if blob is not None:
                tiles.append((ux * unit_tiles + i, uy * unit_tiles + j, blob))
    return z, ux, uy, tiles


def settings(levels, unit_tiles):
    """The recipe: everything that decides what a pixel is, given ground to read."""
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
                "alpha": ("footprint mask" if z < MASK_ALPHA_BELOW_Z
                          else "DEM no-data"),
            }
            for z in levels
        },
    }


def recipe_digest(recipe):
    """Digest of the recipe, over everything except `levels` — levels arrive one
    run at a time, so a database holding z15 has to accept the run that adds z14.

    Stamped into each database as `digest`, so a build extending a file can tell
    whether the pixels already in it were made the same way."""
    body = {k: v for k, v in recipe.items() if k != "levels"}
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:16]


def marked_units(out, project, z):
    """The units this acquisition has finished at this level."""
    store = read_store(out, project)
    if store is None:
        return set()
    with store:
        return store.units(z)


def run_levels(store, project, coverage, levels, unit_tiles=DEFAULT_UNIT_TILES,
               jobs=1, limit=None, done=None):
    """Build the named levels for one acquisition into an open store, skipping
    units already recorded there.

    `store` is None for a dry run, and `done` then has to say what a real run
    would skip. A mask paired with another acquisition's DEM fails silently —
    every unit all-NaN, nothing written, every unit marked done — hence the
    check below."""
    if coverage.project != project:
        sys.exit(
            f"the mask is the footprint of {coverage.project!r}, but the "
            f"acquisition is {project!r}.\nOne of the two is wrong; they have "
            "to name the same ground."
        )
    if done is None:
        done = store.units if store else (lambda z: set())

    for z in levels:
        units = coverage.units(z, unit_tiles)
        pending = [u for u in units if u not in done(z)]
        side_km = tile_span(z) * unit_tiles / 1000
        print(f"\nz{z}  {resolution(z):.4f} m/px  unit {side_km:.2f} km  "
              f"{len(units)} units, {len(pending)} to do")
        if store is None:
            continue
        if limit:
            pending = pending[:limit]
        if not pending:
            continue

        started, tiles = time.perf_counter(), 0
        work = [(z, ux, uy, unit_tiles, project, coverage.path)
                for ux, uy in pending]
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


def report(done, total, tiles, started):
    elapsed = time.perf_counter() - started
    rate = elapsed / done
    print(f"\r  {done}/{total} units, {tiles} tiles, {rate:.1f} s/unit, "
          f"{(total - done) * rate / 3600:.1f} h left", end="", flush=True)


@dataclass
class LevelCheck:
    """What one level of one acquisition holds, against what the mask says it
    should. `todo` never finished; `broken` stored bytes the app cannot draw."""

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
    """Which work unit a tile belongs to."""
    x, y = tile
    return x // unit_tiles, y // unit_tiles


def readable_tile(blob):
    """Does this decode to a tile a browser will draw?

    A full decode, not a header read: a truncated WebP carries an intact header.
    ~5 ms a tile."""
    try:
        with Image.open(BytesIO(blob)) as image:
            image.load()
            return image.size == (TILE_PX, TILE_PX)
    except Exception:
        # Anything Pillow raises on is an image the app cannot draw.
        return False


def check_level(out, project, coverage, z, unit_tiles=DEFAULT_UNIT_TILES,
                progress=None):
    """Read one level of one acquisition out of the store and tally it against
    the mask.

    The `units` table, not the mask alone, is the authority on what should be
    there: a unit the footprint merely clips can legitimately hold no tile."""
    result = LevelCheck(z=z, unit_tiles=unit_tiles)
    units = coverage.units(z, unit_tiles)
    result.units = len(units)

    store = read_store(out, project)
    try:
        marked = store.units(z) if store else set()
        # Marked units the footprint does not reach: the mask was rebuilt, or
        # --unit-tiles changed between runs.
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
            if here == 0:
                result.empty += 1
    finally:
        if store:
            store.close()
    result.done = len(units) - len(result.todo)
    return result


def unmark(out, project, z, units, unit_tiles=DEFAULT_UNIT_TILES):
    """Hand these units back to the build. Their tiles go with them: a rebuild
    that finds a tile all-NaN writes nothing, so a broken tile left in place
    would outlive the repair."""
    path = store_path(out, project)
    if not path.exists():
        return
    with Store(path, write=True) as store:
        store.drop_units(z, units, unit_tiles)


def store_tiles(out, project, z):
    """Every tile at this level of this acquisition, including ones no finished
    unit claims."""
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
