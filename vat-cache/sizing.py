"""Measured bytes per pixel + coverage -> what a cache costs on disk.

The zoom ladder is the app's own: `src/map/layers/wmsTileGrid.ts` builds
resolutions as max(extent span) / 256 / 2**z over the EPSG:25833 extent set in
`src/map/projections/proj/euref89.ts`, with 512 px WMS tiles. So z is this
app's z, not a web-mercator z, and the resolutions are not round metres.

Run:
    python sizing.py          # uses the measured defaults below
"""

import math

# EPSG:25833 extent, from setEUREF89Extents in euref89.ts.
EXTENT = (-2500000.0, 3500000.0, 3045984.0, 9045984.0)
VIEW_TILE_SIZE = 256  # the View's ladder divides the extent by this
WMS_TILE_SIZE = 512  # what wmsTileGrid.ts actually requests
MAX_RESOLUTION = max(EXTENT[2] - EXTENT[0], EXTENT[3] - EXTENT[1]) / VIEW_TILE_SIZE


def resolution(z):
    return MAX_RESOLUTION / 2**z


# Measured by measure.py over six sites in Vestfold og Telemark 5pkt 2021,
# fully covered 256 px tiles only. (PNG, WebP q90) bytes per pixel.
#
# The 0.5 and 1.0 m rows are measure.py's own output, so the 1 m horizon fields
# are decimated from a 0.5 m fetch the way `horizonDecimation` does. The 2 and
# 4 m rows come from the same harness run against DEM fetched at those
# resolutions directly, for the multi-scale study; averaging makes the decimated
# grids marginally smoother, so the two families are not quite interchangeable.
BPP = {
    "vat": {0.5: (0.607, 0.257)},
    "svf": {1.0: (0.613, 0.269), 2.0: (0.651, 0.298), 4.0: (0.617, 0.276)},
    "opos": {1.0: (0.677, 0.334), 2.0: (0.675, 0.321), 4.0: (0.600, 0.257)},
    "oneg": {1.0: (0.670, 0.332), 2.0: (0.653, 0.307), 4.0: (0.568, 0.237)},
}

# Union of the footprints, from coverage.py.
COVERAGE_M2 = 1.106e9


def bpp_at(product, res):
    """Measured value, or linear interpolation between the two that bracket."""
    table = BPP[product]
    keys = sorted(table)
    if res <= keys[0]:
        return table[keys[0]]
    if res >= keys[-1]:
        return table[keys[-1]]
    for a, b in zip(keys, keys[1:]):
        if a <= res <= b:
            t = (res - a) / (b - a)
            return tuple(table[a][i] * (1 - t) + table[b][i] * t for i in (0, 1))


def level_cost(product, res, fill, area_m2=COVERAGE_M2):
    """(pixels, PNG bytes, WebP bytes) for one product at one resolution."""
    px = area_m2 / (res * res)
    png, webp = bpp_at(product, res)
    return px, px * png / fill, px * webp / fill


# Mean covered fraction of a 512 px tile, from coverage.tile_fill over the
# Vestfold og Telemark footprint. Keyed by tile side in metres.
FILL = {169: 0.95, 338: 0.89, 677: 0.79, 1354: 0.65, 2708: 0.48, 5416: 0.33, 256: 0.92}


def fill_for(tile_m):
    return FILL[min(FILL, key=lambda k: abs(k - tile_m))]


def ladder(product, zooms=range(11, 17)):
    print(f"\n{product} on the app's ladder ({WMS_TILE_SIZE} px tiles)")
    print(f"{'z':>3} {'m/px':>8} {'reach':>8} {'tile':>7} {'fill':>5} {'Mpx':>9} {'PNG':>8} {'WebP90':>8}")
    for z in zooms:
        res = resolution(z)
        tile_m = WMS_TILE_SIZE * res
        fill = fill_for(tile_m)
        px, png, webp = level_cost(product, res, fill)
        if product == "vat":
            reach = "presets"
        else:
            reach = f"{24 * res * max(1, int(1.0 // res)):.1f}m"
        print(
            f"{z:3d} {res:8.4f} {reach:>8} {tile_m:6.0f}m {fill:5.2f} "
            f"{px / 1e6:9.1f} {png / 1e9:7.2f}G {webp / 1e9:7.2f}G"
        )


def stack_res(product, resolutions, label):
    """One cost line over an explicit list of resolutions, all natively computed."""
    tp = tw = tpx = 0.0
    for res in resolutions:
        px, png, webp = level_cost(product, res, fill_for(WMS_TILE_SIZE * res))
        tpx += px
        tp += png
        tw += webp
    print(f"  {label:<44} {tpx / 1e9:6.2f} Gpx  PNG {tp / 1e9:5.2f} GB  WebP90 {tw / 1e9:5.2f} GB")
    return tp, tw


def stack(product, base_z, levels, label):
    """Base level plus `levels - 1` coarser ones, on the app's ladder."""
    return stack_res(product, [resolution(base_z - k) for k in range(levels)], label)


def fetch_bytes(base_z, unit_z, margin_m=24.0, bytes_per_px=4):
    """What the DEM fetch costs, fetching once at `base_z` and decimating for the
    coarser levels. Two overheads the naive area/res**2 leaves out, and they pull
    against each other: a work unit is grown by the margin on every side, which
    favours large units, and a unit the footprint only clips is fetched whole,
    which favours small ones."""
    res = resolution(base_z)
    side_px = WMS_TILE_SIZE * 2 ** (base_z - unit_z)
    margin_px = math.ceil(margin_m / res)
    grown = ((side_px + 2 * margin_px) / side_px) ** 2
    fill = fill_for(WMS_TILE_SIZE * resolution(unit_z))
    return COVERAGE_M2 / res**2 / fill * grown * bytes_per_px


if __name__ == "__main__":
    print(f"coverage {COVERAGE_M2 / 1e6:.0f} km2, maxResolution {MAX_RESOLUTION:.1f} m/px at z0")
    ladder("vat")
    ladder("opos")
    print("\ncandidate VAT caches")
    stack("vat", 15, 1, "z15 only (0.661 m/px)")
    stack("vat", 15, 3, "z15 + z14/z13")
    stack("vat", 15, 4, "z15 + z14/z13/z12")
    stack("vat", 16, 1, "z16 only (0.331 m/px)")
    stack("vat", 16, 5, "z16 + z15/z14/z13/z12")
    stack_res("vat", [0.5, 1.0, 2.0], "custom 0.5*2^n grid, three levels")

    print("\nDEM fetch for z15 + z14/z13, by work-unit size")
    for unit_z in (15, 14, 13, 12):
        side_m = WMS_TILE_SIZE * resolution(unit_z)
        print(
            f"  work unit = one z{unit_z} tile ({side_m:5.0f} m)"
            f"   {fetch_bytes(15, unit_z) / 1e9:5.1f} GB"
        )
    print("\nhorizon family, for comparison (all three products)")
    for base, levels, label in ((14, 1, "z14 only"), (14, 4, "z14 + z13/z12/z11")):
        tp = tw = 0.0
        for product in ("svf", "opos", "oneg"):
            a, b = stack(product, base, levels, f"  {product} {label}")
            tp += a
            tw += b
        print(f"  {'-> ' + label:<44} {'':11}  PNG {tp / 1e9:5.2f} GB  WebP90 {tw / 1e9:5.2f} GB")
