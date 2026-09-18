"""Build a cached combined-VAT tile set, one zoom level at a time.

    python build_tiles.py --out /site/tufteseid/data/cvat --levels 15,14,13,12
    python build_tiles.py --out /site/tufteseid/data/cvat --levels 15 --jobs 4

That path is the store docker-compose bind-mounts into the Caddy container at
/var/www/cvat, so what this writes is what the app serves.

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


def settings(project, levels, unit_tiles):
    """Everything that decides what the pixels are. The digest of this is what
    makes a cache built under changed settings declare itself a different one."""
    from importlib.metadata import version

    return {
        "generator": "vat-cache/build_tiles.py",
        "renderer": f"rvt-py {version('rvt-py')}",
        "source": "hoydedata.no Prosjekt_DTM exportImage, pixelType=F32",
        "acquisition": project,
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


def open_manifest(out, project, levels, unit_tiles, force):
    """Write the manifest, or check the one already there agrees with this run."""
    wanted = settings(project, levels, unit_tiles)
    digest = hashlib.sha256(
        json.dumps(wanted, sort_keys=True).encode()
    ).hexdigest()[:16]
    wanted["digest"] = digest
    path = Path(out) / "manifest.json"
    if path.exists():
        have = json.loads(path.read_text())
        if have.get("digest") != digest and not force:
            sys.exit(
                f"{path} was built under different settings "
                f"(digest {have.get('digest')}, this run {digest}).\n"
                "A cache mixing two settings cannot say what it is. Build into "
                "an empty directory, or pass --force if you know why."
            )
        # Levels arrive one run at a time; keep the ones already built.
        wanted["levels"] = {**have.get("levels", {}), **wanted["levels"]}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(wanted, indent=2, sort_keys=True))
    return digest


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", required=True, help="tile store directory")
    p.add_argument("--project", default=fetch_dem.DEFAULT_PROJECT)
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

    if not args.dry_run:
        digest = open_manifest(out, args.project, levels, args.unit_tiles, args.force)
        print(f"{out}  manifest {digest}  {args.project}")

    for z in levels:
        units = coverage.units(z, args.unit_tiles)
        marks = out / ".units" / str(z)
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
