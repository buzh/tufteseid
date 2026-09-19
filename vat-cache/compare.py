"""What the cached cVAT should be computed on: one real patch, every candidate.

Fetches the native 0.25 m DTM once, area-averages it to each candidate grid, and
renders RVT's combined VAT on each under both radius rules:

  pixels  - RVT's r_max verbatim (10 / 20 px), which is how the templates state
            it, so every level is a canonical VAT of its own grid and the reach
            grows as you zoom out
  metres  - r_max scaled to hold the 5 m / 10 m reach the 0.5 m templates come
            to, so every level shows the same ground fact and the sampling
            thins as you zoom out

Reports bytes per pixel and seconds per km2 for each, and writes PNGs to look at.
"""

import sys
import time
from io import BytesIO

import numpy as np
from PIL import Image

import fetch_dem
from cvat import cvat, radii_for

# The app's ladder: max(EPSG:25833 extent span) / 256 / 2**z, from wmsTileGrid.ts.
# z16 is the base over a 0.25 m DTM and still coarser than it, so it is an area
# average of the native fetch like every other row rather than an upsample.
LEVELS = {"z16": 0.33057, "z15": 0.66113, "z14": 1.32227,
          "z13": 2.64453, "z12": 5.28906}
NATIVE_M_PER_PX = 0.25
SIDE_M = 500
# Dropped from every edge before measuring: the horizon scan reads a short
# horizon where its rays leave the grid, and that frame is not what a tile shows.
CROP_M = 25


def area_resample(dem, src_res, dst_res):
    """Block mean to an arbitrary cell size. PIL's BOX filter is an area average
    and handles the non-integer factors the app's ladder produces."""
    if abs(src_res - dst_res) < 1e-9:
        return dem
    h, w = dem.shape
    out_w = max(1, int(round(w * src_res / dst_res)))
    out_h = max(1, int(round(h * src_res / dst_res)))
    img = Image.fromarray(dem.astype(np.float32), mode="F")
    return np.asarray(img.resize((out_w, out_h), Image.BOX), dtype=np.float32)


def encode(arr8, fmt, **kw):
    buf = BytesIO()
    Image.fromarray(arr8, mode="L").save(buf, fmt, **kw)
    return buf.getbuffer().nbytes


def run(cx, cy, tag):
    dem_native = fetch_dem.fetch(cx, cy, SIDE_M, int(SIDE_M / NATIVE_M_PER_PX))
    print(f"\n{tag}  {dem_native.shape} at {NATIVE_M_PER_PX} m, "
          f"relief {np.nanmax(dem_native) - np.nanmin(dem_native):.1f} m")
    print(f"{'grid':>6} {'m/px':>7} {'radii':>8} {'px':>6} {'s':>6} "
          f"{'s/km2':>7} {'PNG':>6} {'WebP90':>7}  reach")

    # 0.5 m is not on the app's ladder; it is RVT's calibration, carried as the
    # reference row rather than as a candidate.
    grids = [("rvt0.5", 0.5)] + list(LEVELS.items())
    for name, res in grids:
        dem = area_resample(dem_native, NATIVE_M_PER_PX, res)
        for mode, in_metres in (("pixels", False), ("metres", True)):
            t = time.perf_counter()
            out = cvat(dem, res, radius_in_metres=in_metres)
            dt = time.perf_counter() - t
            crop = int(round(CROP_M / res))
            inner = out[crop:-crop, crop:-crop]
            arr8 = np.nan_to_num(inner * 255, nan=0).astype(np.uint8)
            n = arr8.size
            km2 = n * res * res / 1e6
            png = encode(arr8, "PNG", optimize=True)
            webp = encode(arr8, "WEBP", quality=90)
            r = radii_for(res, in_metres)
            reach = (f"{r['general']['r_max_m']:.1f}/{r['flat']['r_max_m']:.1f} m "
                     f"({r['general']['r_max_px']}/{r['flat']['r_max_px']} px)")
            print(f"{name:>6} {res:7.4f} {mode:>8} {inner.shape[0]:6d} {dt:6.2f} "
                  f"{dt / km2:7.1f} {png / n:6.3f} {webp / n:7.3f}  {reach}")
            Image.fromarray(arr8, mode="L").save(
                f"/tmp/cvat_{tag}_{name}_{mode}.png", optimize=True)


if __name__ == "__main__":
    sites = [(228107, 6607163, "a"), (186929, 6576959, "b")]
    if len(sys.argv) > 1:
        sites = sites[: int(sys.argv[1])]
    for cx, cy, tag in sites:
        run(cx, cy, tag)
