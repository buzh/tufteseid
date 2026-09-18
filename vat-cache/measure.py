"""How many bytes a rendered tile costs, measured rather than guessed.

Fetches DEM at each sample site, runs the operators in render.py, quantises to
8-bit the way `paintTerrainField` does, cuts 256 px tiles and encodes them.
Reports bytes per pixel per product, which is the only input `sizing.py` needs
that cannot be derived.

Two rules the measurement follows, both of which matter:

- Only *fully covered* tiles are counted. A tile with NaN in it encodes small
  because the NaN fill is flat, which would flatter the estimate.
- The stretch is pooled across every site, not taken per tile. A per-tile
  percentile is not available to a tiled layer at all: neighbouring tiles would
  disagree, which is the same fault that got `dynamisk_farget_hoyde` excluded
  in `src/map/layers/config/backgroundLayers/lidarProjects.ts`. VAT alone needs
  no pooling -- it composites to 0..1 on absolute stretches.

Run (after coverage.py):
    python measure.py
"""

import io

import numpy as np
from PIL import Image

import render
from fetch_dem import fetch

TILE = 256
SIDE_M = 1024.0  # ground per sample, before the margin
MARGIN_M = 24.0  # DEM_MARGIN_M: the longest reach horizon can ask for

# The grid each product is computed on. VAT's is pinned by VAT_SCAN_M_PER_PX;
# the horizon family's by HORIZON_MIN_M_PER_PX, below which reach shrinks.
VAT_M_PER_PX = render.VAT_SCAN_M_PER_PX
HORIZON_M_PER_PX = render.HORIZON_MIN_M_PER_PX


def fields_at_site(cx, cy):
    """VAT at 0.5 m and the horizon trio at 1 m, margins cropped off."""
    px = int((SIDE_M + 2 * MARGIN_M) / VAT_M_PER_PX)
    z = fetch(cx, cy, SIDE_M + 2 * MARGIN_M, px)

    m = int(MARGIN_M / VAT_M_PER_PX)
    out = {"vat": render.vat(z, VAT_M_PER_PX)[m:-m, m:-m]}

    factor = int(HORIZON_M_PER_PX / VAT_M_PER_PX)
    coarse = render.decimate(z, factor)
    m = int(MARGIN_M / HORIZON_M_PER_PX)
    svf, open_pos, open_neg = render.scan_horizon(
        coarse, HORIZON_M_PER_PX, render.horizon_max_radius_metres(HORIZON_M_PER_PX), 0
    )
    out["svf"] = svf[m:-m, m:-m]
    out["opos"] = open_pos[m:-m, m:-m]
    out["oneg"] = open_neg[m:-m, m:-m]
    return out


def pooled_stretch(arrays, lo=2, hi=98):
    vals = np.concatenate([a[~np.isnan(a)].ravel()[::7] for a in arrays])
    return float(np.percentile(vals, lo)), float(np.percentile(vals, hi))


def encode(tile8, fmt, **kw):
    buf = io.BytesIO()
    Image.fromarray(tile8).save(buf, fmt, **kw)
    return buf.getbuffer().nbytes


def measure(fields_by_site):
    """-> {product: (png_bytes_per_px, webp90_bytes_per_px, tiles, (lo, hi))}"""
    results = {}
    for key in ("vat", "svf", "opos", "oneg"):
        arrays = [f[key] for f in fields_by_site]
        lo, hi = (0.0, 1.0) if key == "vat" else pooled_stretch(arrays)
        png = webp = count = 0
        for field in arrays:
            h, w = field.shape
            for j in range(0, h, TILE):
                for i in range(0, w, TILE):
                    t = field[j : j + TILE, i : i + TILE]
                    if t.shape != (TILE, TILE) or np.isnan(t).any():
                        continue
                    q = np.clip((t - lo) / (hi - lo), 0, 1)
                    if key == "oneg":
                        q = 1 - q  # drawn on a reversed ramp, as in render.ts
                    g = np.rint(q * 255).astype(np.uint8)
                    png += encode(g, "PNG", optimize=True)
                    webp += encode(np.stack([g] * 3, -1), "WEBP", quality=90, method=4)
                    count += 1
        px = count * TILE * TILE
        results[key] = (png / px, webp / px, count, (lo, hi))
    return results


def main():
    data = np.load("coverage.npz")
    sites = data["sites"]
    fields = []
    for i, (cx, cy) in enumerate(sites):
        f = fields_at_site(cx, cy)
        fields.append(f)
        print(f"  site {i} ({cx:.0f}, {cy:.0f}) rendered", flush=True)

    print(f"\n{'product':>8} {'PNG B/px':>9} {'WebP90':>8} {'tiles':>6}  stretch")
    for key, (png, webp, count, (lo, hi)) in measure(fields).items():
        print(f"{key:>8} {png:9.3f} {webp:8.3f} {count:6d}  {lo:.3f}-{hi:.3f}")


if __name__ == "__main__":
    main()
