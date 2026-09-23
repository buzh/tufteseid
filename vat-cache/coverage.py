"""What ground a LiDAR acquisition actually covers, and where to sample it.

`sum(SHAPE.AREA)` is not the coverage: the mosaic catalogue carries one row per
raster plus a row per overview level, and every level re-covers the whole
project. Rasterise the union of the footprints instead.
"""

from pathlib import Path

import numpy as np

from acquisitions import slug
from fetch_dem import catalogue

CELL = 25.0  # rasterisation cell, metres

HERE = Path(__file__).resolve().parent


def footprints(project):
    """Catalogue rows with geometry, for one LAS_PROJECT_NAME."""
    return catalogue(
        f"LAS_PROJECT_NAME = '{project}'",
        out_fields=["OBJECTID", "CATEGORY", "LOWPS", "SHAPE.AREA"],
        geometry=True,
    )["features"]


def rasterise(features, cell=CELL):
    """Even-odd scanline fill of the union. Returns (mask, (x0, x1, y0, y1), cell)."""
    rings = [np.asarray(r) for f in features for r in f["geometry"]["rings"]]
    xs = np.concatenate([r[:, 0] for r in rings])
    ys = np.concatenate([r[:, 1] for r in rings])
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    w = int(np.ceil((x1 - x0) / cell))
    h = int(np.ceil((y1 - y0) / cell))
    mask = np.zeros((h, w), bool)

    for f in features:
        sub_rings = f["geometry"].get("rings", [])
        if not sub_rings:
            continue
        sub = np.zeros((h, w), bool)
        ry0 = min(min(p[1] for p in r) for r in sub_rings)
        ry1 = max(max(p[1] for p in r) for r in sub_rings)
        for j in range(max(0, int((ry0 - y0) / cell)), min(h - 1, int((ry1 - y0) / cell)) + 1):
            yc = y0 + (j + 0.5) * cell
            crossings = []
            for r in sub_rings:
                a = np.asarray(r)
                ya, yb = a[:-1, 1], a[1:, 1]
                xa, xb = a[:-1, 0], a[1:, 0]
                sel = ((ya <= yc) & (yb > yc)) | ((yb <= yc) & (ya > yc))
                if sel.any():
                    t = (yc - ya[sel]) / (yb[sel] - ya[sel])
                    crossings.append(xa[sel] + t * (xb[sel] - xa[sel]))
            if not crossings:
                continue
            xi = np.sort(np.concatenate(crossings))
            for k in range(0, len(xi) - 1, 2):
                i0 = int(np.ceil((xi[k] - x0) / cell - 0.5))
                i1 = int(np.floor((xi[k + 1] - x0) / cell - 0.5))
                if i1 >= i0:
                    sub[j, max(0, i0) : min(w - 1, i1) + 1] = True
        mask |= sub
    return mask, (x0, x1, y0, y1), cell


def sample_sites(mask, bounds, cell, count=6, side_m=1024.0, seed=7):
    """Centres where a side_m square sits wholly inside coverage, spread apart."""
    x0, _x1, y0, _y1 = bounds
    h, w = mask.shape
    integral = np.cumsum(np.cumsum(mask.astype(np.int32), 0), 1)
    r = int(np.ceil(side_m / 2 / cell))
    full = (2 * r + 1) ** 2

    def boxsum(j, i):
        j0, j1, i0, i1 = j - r, j + r, i - r, i + r
        a = integral[j1, i1]
        b = integral[j0 - 1, i1] if j0 > 0 else 0
        c = integral[j1, i0 - 1] if i0 > 0 else 0
        d = integral[j0 - 1, i0 - 1] if (j0 > 0 and i0 > 0) else 0
        return a - b - c + d

    rng = np.random.default_rng(seed)
    js, iss = np.nonzero(mask)
    candidates = []
    for k in rng.permutation(len(js)):
        j, i = js[k], iss[k]
        if j - r < 0 or j + r >= h or i - r < 0 or i + r >= w:
            continue
        if boxsum(j, i) == full:
            candidates.append((x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell))
        if len(candidates) > 4000:
            break
    if not candidates:
        # No square of this size fits inside the footprint; ordinary for small
        # supplementary acquisitions, and the build needs no sites.
        return np.empty((0, 2))
    candidates = np.array(candidates)

    picked = [candidates[0]]
    for _ in range(count - 1):
        d = np.min(
            np.linalg.norm(candidates[:, None, :] - np.array(picked)[None, :, :], axis=2),
            axis=1,
        )
        picked.append(candidates[int(np.argmax(d))])
    return np.array(picked)


def tile_fill(mask, cell, tile_m, grid_origin=(-2500000.0, 9045984.0), mask_origin=None):
    """Tiles touched, and their mean covered fraction, on the app's tile grid.

    grid_origin is the EPSG:25833 top-left the app's TileGrid uses
    (src/map/layers/wmsTileGrid.ts, origin = [extent[0], extent[3]]).
    """
    h, w = mask.shape
    mx0, my0 = mask_origin
    gx0, gy0 = grid_origin
    ii = np.arange(w) * cell + mx0 - gx0
    jj = np.arange(h) * cell + my0 - gy0
    ti = np.floor(ii / tile_m).astype(np.int64)
    tj = np.floor(jj / tile_m).astype(np.int64)
    ti -= ti.min()
    tj -= tj.min()
    shape = (tj.max() + 1, ti.max() + 1)
    counts = np.zeros(shape[0] * shape[1], np.int64)
    idx = (tj[:, None] * shape[1] + ti[None, :]).ravel()
    np.add.at(counts, idx[mask.ravel()], 1)
    per_tile = (tile_m / cell) ** 2
    hit = counts > 0
    return int(hit.sum()), float((counts[hit] / per_tile).mean())


def mask_file(project, directory=None):
    """Where this acquisition's mask lives."""
    return Path(directory or HERE) / f"coverage-{slug(project)}.npz"


def load_or_build(project, directory=None):
    """The acquisition's mask, derived on first use. Returns its path."""
    path = mask_file(project, directory)
    if not path.exists():
        print(f"no mask for {project!r} yet; deriving {path.name}\n")
        build_mask(project, path)
        print()
    return path


def build_mask(project, out):
    feats = footprints(project)
    by_category = {}
    for f in feats:
        a = f["attributes"]
        key = (a["CATEGORY"], a["LOWPS"])
        by_category.setdefault(key, 0.0)
        by_category[key] += a["SHAPE.AREA"]
    print(f"{project}: {len(feats)} catalogue rows")
    for key in sorted(by_category):
        print(f"  CATEGORY {key[0]} LOWPS {key[1]:>9}: {by_category[key] / 1e6:8.0f} km2")
    print(f"  sum of SHAPE.AREA           : {sum(by_category.values()) / 1e6:8.0f} km2 <- not the coverage")

    mask, bounds, cell = rasterise(feats)
    x0, x1, y0, y1 = bounds
    area = mask.sum() * cell * cell
    print(f"\n  union of footprints         : {area / 1e6:8.0f} km2 <- the coverage")
    print(f"  envelope {x0:.0f},{y0:.0f} .. {x1:.0f},{y1:.0f}")
    print(f"           {(x1 - x0) / 1000:.1f} x {(y1 - y0) / 1000:.1f} km, {area / ((x1 - x0) * (y1 - y0)) * 100:.0f} % filled")

    np.savez(
        out,
        mask=mask,
        bounds=np.array(bounds),
        cell=cell,
        sites=sample_sites(mask, bounds, cell),
        # build_tiles.py checks this stamp: a mask paired with another
        # acquisition's DEM fails silently, writing no tiles but marking done.
        project=project,
    )
    print(f"\n  wrote {Path(out).name} (mask, bounds, cell, sites, project)")
    return area
