"""The tile store: its geometry, how a level is built into it, and how it is
verified afterwards. `vatcache.py` is the command line over all of it.

The store is what docker-compose bind-mounts into the Caddy container at
/var/www/cvat, so what this writes is what the app serves.

One store holds several acquisitions, each in its own directory:
`<slug>/<z>/<x>/<y>.webp`, with the slug recorded in the manifest as the
acquisition's `path`. Overlap is the reason. Two flights over one landscape are
two pictures of it — a 5pkt from 2015 and a 10pkt from 2025 are not the same
ground twice — and the app offers both as rows, so their tiles cannot be
allowed to contend for one name. Markers live under the same slug, as they
always have.

Resumable: every work unit drops a marker when it finishes, and a re-run skips
the marked ones. A unit that writes no tiles still marks, because "the footprint
turned out not to reach here" and "never ran" are different states. That is also
why a check reads the markers rather than counting tiles: only the marker can
tell an edge unit that legitimately holds nothing from one that never ran.

Each level is an independent job — its own fetch, its own scan, its own tiles —
so levels can be built in any order, or one rebuilt without the others. See
WORK-ORDER.md for why the radii are RVT's pixels rather than fixed metres, which
is what makes the levels independent in the first place.
"""

import hashlib
import json
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


def tile_dir(out, project):
    """The acquisition's own corner of the store, and what the manifest hands
    the app as its `path`. Two flights over one landscape are two pictures of
    it, both offered, so neither may write into the other's tiles."""
    return Path(out) / slug(project)


def tile_path(out, project, z, ux, uy, unit_tiles, i, j):
    """Where the (i, j)-th tile of one work unit lands. The one place the unit
    grid is turned into the app's tile coordinates, so a check cannot disagree
    with the writer about which tiles a unit owns."""
    x, y = ux * unit_tiles + i, uy * unit_tiles + j
    return tile_dir(out, project) / str(z) / str(x) / f"{y}.webp"


def unit_tile_paths(out, project, z, ux, uy, unit_tiles):
    return [
        tile_path(out, project, z, ux, uy, unit_tiles, i, j)
        for j in range(unit_tiles)
        for i in range(unit_tiles)
    ]


def build_unit(args):
    """Fetch, render and write one work unit. Runs in a worker process."""
    z, ux, uy, unit_tiles, project, out = args
    res = resolution(z)
    dem = fetch_unit(z, ux, uy, unit_tiles, project)
    # radius_in_metres=False: RVT's max_rad as written, so this level is RVT's
    # combined VAT of its own grid.
    composite = cvat.cvat(dem, res, radius_in_metres=False)
    inner = composite[OVERLAP_PX:-OVERLAP_PX, OVERLAP_PX:-OVERLAP_PX]

    written = 0
    for j in range(unit_tiles):
        for i in range(unit_tiles):
            tile = inner[j * TILE_PX:(j + 1) * TILE_PX, i * TILE_PX:(i + 1) * TILE_PX]
            blob = encode_tile(tile)
            if blob is None:
                continue
            path = tile_path(out, project, z, ux, uy, unit_tiles, i, j)
            path.parent.mkdir(parents=True, exist_ok=True)
            # Write then rename: a kill mid-write must not leave a half tile
            # that the marker then declares finished.
            tmp = path.with_suffix(".webp.part")
            tmp.write_bytes(blob)
            tmp.replace(path)
            written += 1
    return z, ux, uy, written


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


def open_manifest(out, project, levels, unit_tiles, force):
    """Write the manifest, or check the one already there agrees with this run."""
    recipe = settings(levels, unit_tiles)
    digest = _digest(recipe)
    path = Path(out) / "manifest.json"

    # What ground is in the store, where its tiles are, and at which levels. Per
    # acquisition, because a level built for one is not built for another: a
    # reader asking "is z12 here for Østfold" must not be answered by Vestfold's
    # z12. `path` is the app's tile template, so the slug rule lives here alone
    # and no second implementation of it can drift.
    entry = {"levels": sorted(levels, reverse=True), "path": slug(project)}
    acquisitions = {project: entry}

    if path.exists():
        have = json.loads(path.read_text())
        # A manifest from when a store held exactly one acquisition carried it
        # inside the digest. Same recipe, older shape: migrate it rather than
        # making the operator reach for --force, which would equally have waved
        # through a recipe that really had changed.
        legacy = "acquisitions" not in have and "acquisition" in have
        agrees = have.get("digest") == digest or (
            legacy and have.get("digest") == _digest(recipe, have["acquisition"])
        )
        if not agrees and not force:
            sys.exit(
                f"{path} was built under different settings "
                f"(digest {have.get('digest')}, this run {digest}).\n"
                "A cache mixing two settings cannot say what it is. Build into "
                "an empty directory, or pass --force if you know why."
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


def marker_dir(out, project, z):
    """Where one acquisition's finished-unit markers for level z live.

    Namespaced by acquisition, for the same reason the tiles are: overlap is
    expected and wanted, so two acquisitions can own the same work unit and the
    same tile coordinates inside it. Vestfold 10pkt 2025 lies almost wholly on
    top of Vestfold og Telemark 5pkt 2021, and one's marker must not tell the
    other that its tiles are written."""
    return Path(out) / ".units" / slug(project) / str(z)


def marked_units(out, project, z):
    """The units this acquisition has finished at this level, off the markers
    alone. Cheap enough to ask for a progress figure without a mask at hand."""
    found = set()
    for mark in marker_dir(out, project, z).glob("*_*"):
        ux, _, uy = mark.name.partition("_")
        try:
            found.add((int(ux), int(uy)))
        except ValueError:
            continue
    return found


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

    if not dry_run:
        digest = open_manifest(out, project, levels, unit_tiles, force)
        print(f"{out}  manifest {digest}  {project}")

    for z in levels:
        units = coverage.units(z, unit_tiles)
        marks = marker_dir(out, project, z)
        done = marked_units(out, project, z)
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
        marks.mkdir(parents=True, exist_ok=True)

        started, tiles = time.perf_counter(), 0
        work = [(z, ux, uy, unit_tiles, project, str(out)) for ux, uy in pending]
        if jobs > 1:
            with ProcessPoolExecutor(max_workers=jobs) as pool:
                futures = {pool.submit(build_unit, w): w for w in work}
                for finished, future in enumerate(as_completed(futures), 1):
                    _z, ux, uy, n = future.result()
                    (marks / f"{ux}_{uy}").touch()
                    tiles += n
                    report(finished, len(work), tiles, started)
        else:
            for finished, item in enumerate(work, 1):
                _z, ux, uy, n = build_unit(item)
                (marks / f"{ux}_{uy}").touch()
                tiles += n
                report(finished, len(work), tiles, started)
        print()


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
    the run that produced them: one never finished, the other wrote a file the
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
    parts: list = field(default_factory=list)
    stray: list = field(default_factory=list)

    @property
    def ok(self):
        return not (self.todo or self.broken or self.parts)

    @property
    def repairable(self):
        """Units to hand back: the unbuilt ones, plus the ones holding a file
        that does not decode or a leftover half-write."""
        hurt = {unit_of(p, self.unit_tiles) for p in self.broken + self.parts}
        return sorted(set(self.todo) | hurt)


def unit_of(path, unit_tiles):
    """Which work unit a tile path belongs to. The inverse of `tile_path`."""
    x, y = int(path.parent.name), int(path.name.split(".")[0])
    return x // unit_tiles, y // unit_tiles


def readable_tile(path):
    """Does this file decode to a tile a browser will draw?

    A full decode rather than a header read, because the failure worth finding
    is truncation and a truncated WebP carries an intact header. Writes go to
    `.part` and rename, so this should never fire — which is the reason it is
    worth asking. ~5 ms a tile, so a whole level is a minute or two."""
    try:
        with Image.open(path) as image:
            image.load()
            return image.size == (TILE_PX, TILE_PX)
    except Exception:
        # Anything Pillow raises on is an image the app cannot draw. Which of
        # its half-dozen exception types it was does not change the repair.
        return False


def check_level(out, project, coverage, z, unit_tiles=DEFAULT_UNIT_TILES,
                progress=None):
    """Read one level of one acquisition off disk and tally it against the mask.

    The markers are the authority on what should be there, not the mask alone: a
    unit the footprint merely clips can legitimately hold no tile at all, and
    only the marker separates that from a unit that never ran."""
    out = Path(out)
    result = LevelCheck(z=z, unit_tiles=unit_tiles)
    units = coverage.units(z, unit_tiles)
    result.units = len(units)

    marked = marked_units(out, project, z)
    # A marker for a unit the footprint does not reach: the mask was rebuilt, or
    # --unit-tiles changed between runs. Harmless in itself, but it means marker
    # and mask no longer describe the same division of the ground.
    result.stray = sorted(marked - set(units))

    for seen, (ux, uy) in enumerate(units, 1):
        if progress:
            progress(seen, len(units))
        if (ux, uy) not in marked:
            result.todo.append((ux, uy))
            continue
        here = 0
        for path in unit_tile_paths(out, project, z, ux, uy, unit_tiles):
            part = path.with_suffix(".webp.part")
            if part.exists():
                result.parts.append(part)
            if not path.exists():
                continue
            here += 1
            result.bytes += path.stat().st_size
            if not readable_tile(path):
                result.broken.append(path)
        result.tiles += here
        # A finished unit holding nothing is the footprint clipping its corner,
        # and normal at the edge. Every unit empty is the wrong-project trap.
        if here == 0:
            result.empty += 1
    result.done = len(units) - len(result.todo)
    return result


def unmark(out, project, z, units, unit_tiles=DEFAULT_UNIT_TILES):
    """Hand these units back to the build. Their tiles go first: a rebuild that
    decides a tile is all-NaN writes nothing there, so a broken file left in
    place would outlive the repair meant to clear it."""
    marks = marker_dir(out, project, z)
    for ux, uy in units:
        for path in unit_tile_paths(out, project, z, ux, uy, unit_tiles):
            path.unlink(missing_ok=True)
            path.with_suffix(".webp.part").unlink(missing_ok=True)
        (marks / f"{ux}_{uy}").unlink(missing_ok=True)


def store_tiles(out, project, z):
    """Every tile on disk at this level of this acquisition — including the ones
    no work unit claims, which is what makes it worth reading off disk rather
    than deriving from the markers."""
    found = set()
    level = tile_dir(out, project) / str(z)
    if not level.is_dir():
        return found
    for column in level.iterdir():
        if not column.is_dir():
            continue
        try:
            x = int(column.name)
        except ValueError:
            continue
        for tile in column.glob("*.webp"):
            try:
                found.add((x, int(tile.stem)))
            except ValueError:
                continue
    return found


def tiles_under(units, unit_tiles):
    """The tile coordinates a set of work units covers."""
    return {
        (ux * unit_tiles + i, uy * unit_tiles + j)
        for ux, uy in units
        for j in range(unit_tiles)
        for i in range(unit_tiles)
    }
