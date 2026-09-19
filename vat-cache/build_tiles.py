"""Build a cached combined-VAT tile set, one zoom level at a time.

    python build_tiles.py --out /site/tufteseid/data/cvat \
        --project "Vestfold og Telemark 5pkt 2021" --coverage coverage.npz

That path is the store docker-compose bind-mounts into the Caddy container at
/var/www/cvat, so what this writes is what the app serves.

One store holds several acquisitions. Their tiles share the `<z>/<x>/<y>`
namespace, which is safe because footprints do not overlap where it matters and
a tile carries no provenance of its own — the manifest's `acquisitions` block
is the record of what is in here. Markers are *not* shared: they live under the
acquisition that made them, because two acquisitions can land in one work unit
while owning different tiles inside it, and a marker from one must not persuade
the other that its own tiles are already written.

Resumable: every work unit drops a marker when it finishes, and a re-run skips
the marked ones. A unit that writes no tiles still marks, because "the footprint
turned out not to reach here" and "never ran" are different states.

Each level is an independent job — its own fetch, its own scan, its own tiles —
so levels can be built in any order, or one rebuilt without the others. See
WORK-ORDER.md for why the radii are RVT's pixels rather than fixed metres, which
is what makes the levels independent in the first place.
"""

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
from concurrent.futures import ProcessPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

import cvat
import fetch_dem

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
DEFAULT_LEVELS = (15, 14, 13, 12)
WEBP_QUALITY = 90


def resolution(z):
    return MAX_RESOLUTION / 2**z


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
            x, y = ux * unit_tiles + i, uy * unit_tiles + j
            path = Path(out) / str(z) / str(x) / f"{y}.webp"
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

    # What ground is in the store, and at which levels. Per acquisition, because
    # a level built for one is not built for another: a reader asking "is z12
    # here for Østfold" must not be answered by Vestfold's z12.
    acquisitions = {project: {"levels": sorted(levels, reverse=True)}}

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
        merged[project] = {"levels": sorted(set(was) | set(levels), reverse=True)}
        acquisitions = merged

    wanted = {**recipe, "digest": digest, "acquisitions": acquisitions}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(wanted, indent=2, sort_keys=True))
    return digest


def marker_dir(out, project, z):
    """Where one acquisition's finished-unit markers for level z live.

    Namespaced by acquisition: two of them can share a work unit while owning
    different tiles inside it, so one's marker must not tell the other that its
    own tiles are written. Vestfold og Telemark 5pkt 2021 and Viken laser -
    Østfold 5pkt del1 2022 share exactly two z12 units and no tiles at all."""
    return Path(out) / ".units" / slug(project) / str(z)


def slug(project):
    """A directory name for an acquisition. Readable rather than opaque, so the
    marker tree can be read with ls; the acquisition names differ by region,
    density and year, so this cannot collide in practice."""
    return re.sub(r"[^0-9a-zæøå]+", "-", project.lower()).strip("-")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", required=True, help="tile store directory")
    # No default. The store holds several acquisitions and the coverage file is
    # chosen separately, so a default here is a silent way to pair one
    # acquisition's footprint with another's DEM.
    p.add_argument("--project", required=True,
                   help=f'LAS_PROJECT_NAME, e.g. "{fetch_dem.DEFAULT_PROJECT}"')
    p.add_argument("--coverage", default="coverage.npz",
                   help="from coverage.py, for the footprint union")
    p.add_argument("--levels", default=",".join(str(z) for z in DEFAULT_LEVELS))
    p.add_argument("--unit-tiles", type=int, default=DEFAULT_UNIT_TILES)
    p.add_argument("--jobs", type=int, default=1,
                   help="units in parallel; every one is a fetch, so be kind")
    p.add_argument("--limit", type=int,
                   help="stop after this many *unmarked* units, for a pilot; "
                        "run it twice and it does the next batch, not the same one")
    p.add_argument("--dry-run", action="store_true", help="count units and stop")
    p.add_argument("--force", action="store_true",
                   help="write into a store whose manifest disagrees")
    args = p.parse_args()

    levels = [int(z) for z in args.levels.split(",")]
    coverage = Coverage(args.coverage)
    out = Path(args.out)

    # The mask and the DEM have to be of the same ground. Pairing them wrongly
    # is not loud: the fetch is pinned to a project that never flew there, every
    # unit comes back all-NaN, nothing is written, and every unit marks itself
    # done — a store that looks built and is empty.
    if coverage.project is None:
        sys.exit(
            f"{args.coverage} carries no acquisition name, so it cannot be "
            f"checked against --project.\nRe-run: python coverage.py "
            f'"{args.project}"'
        )
    if coverage.project != args.project:
        sys.exit(
            f"{args.coverage} is the footprint of {coverage.project!r}, but "
            f"--project says {args.project!r}.\nOne of the two is wrong; they "
            "have to name the same acquisition."
        )

    if not args.dry_run:
        digest = open_manifest(out, args.project, levels, args.unit_tiles, args.force)
        print(f"{out}  manifest {digest}  {args.project}")

    for z in levels:
        units = coverage.units(z, args.unit_tiles)
        marks = marker_dir(out, args.project, z)
        pending = [u for u in units if not (marks / f"{u[0]}_{u[1]}").exists()]
        side_km = tile_span(z) * args.unit_tiles / 1000
        print(f"\nz{z}  {resolution(z):.4f} m/px  unit {side_km:.2f} km  "
              f"{len(units)} units, {len(pending)} to do")
        if args.dry_run:
            continue
        if args.limit:
            pending = pending[: args.limit]
        marks.mkdir(parents=True, exist_ok=True)

        started, tiles = time.perf_counter(), 0
        work = [(z, ux, uy, args.unit_tiles, args.project, str(out))
                for ux, uy in pending]
        if args.jobs > 1:
            with ProcessPoolExecutor(max_workers=args.jobs) as pool:
                futures = {pool.submit(build_unit, w): w for w in work}
                for done, future in enumerate(as_completed(futures), 1):
                    _z, ux, uy, n = future.result()
                    (marks / f"{ux}_{uy}").touch()
                    tiles += n
                    report(done, len(work), tiles, started)
        else:
            for done, item in enumerate(work, 1):
                _z, ux, uy, n = build_unit(item)
                (marks / f"{ux}_{uy}").touch()
                tiles += n
                report(done, len(work), tiles, started)
        print()


def report(done, total, tiles, started):
    elapsed = time.perf_counter() - started
    rate = elapsed / done
    print(f"\r  {done}/{total} units, {tiles} tiles, {rate:.1f} s/unit, "
          f"{(total - done) * rate / 3600:.1f} h left", end="", flush=True)


if __name__ == "__main__":
    main()
