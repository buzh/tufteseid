"""numpy port of the operators in `src/terrain/shade.ts`.

Parity with the browser is the whole point: a cached tile and the client's own
Analyse render of the same ground have to be the same picture, or the app is
showing a reader two products that look alike and are not. Every constant here
is copied from `shade.ts` rather than rederived, and the functions follow its
arithmetic step for step — including the details that look like accidents:

- `scanHorizon` seeds maxTan/minTan from the first readable cell rather than
  from +-Infinity, so a direction with nothing readable reads as level ground.
  Vectorised that is fmax/fmin over NaN, then NaN -> 0.
- `composeVat` collapses two of RVT's three blend modes, because over
  single-band data a luminosity blend is the active layer and an opacity is a
  linear mix. Only overlay keeps its arithmetic, driving off the background.

`docs/terrain-analysis.md` is the authority on why any of these numbers are
what they are. If it and this file disagree, this file is wrong.
"""

import math

import numpy as np

# --- constants, copied from src/terrain/shade.ts -------------------------

SVF_DIRECTIONS = 16
SVF_MAX_RADIUS_PX = 24
HORIZON_MIN_M_PER_PX = 1.0

VAT_AZIMUTH = 315
VAT_Z_FACTOR = 1
VAT_SCAN_M_PER_PX = 0.5
VAT_MAX_SCAN_CELLS = 1_250_000
VAT_GENERAL_OPACITY = 0.5

VAT_PRESETS = {
    "general": dict(
        sunAltitude=35,
        slopeMax=50,
        opennessMin=68,
        opennessMax=93,
        svfMin=0.7,
        radiusMetres=5,
        innerMetres=0,
    ),
    "flat": dict(
        sunAltitude=15,
        slopeMax=15,
        opennessMin=85,
        opennessMax=93,
        svfMin=0.9,
        radiusMetres=10,
        innerMetres=4,
    ),
}

# VAT_STACK, as data, for a manifest to record. The compositor does not consume
# it -- see composeVat in shade.ts for why the two are written out separately.
VAT_STACK = (
    dict(vis="hillshade", blend="normal", opacity=100),
    dict(vis="slope", blend="luminosity", opacity=50),
    dict(vis="openPos", blend="overlay", opacity=100),
    dict(vis="svf", blend="multiply", opacity=25),
)


def max_decimation(metres_per_px: float) -> int:
    return max(1, int(HORIZON_MIN_M_PER_PX // metres_per_px))


def horizon_max_radius_metres(metres_per_px: float) -> float:
    """The longest horizon this grid can deliver. 24 m at 1 m or finer."""
    return SVF_MAX_RADIUS_PX * metres_per_px * max_decimation(metres_per_px)


def vat_decimation(width_m: float, height_m: float, metres_per_px: float) -> int:
    finest = max(1, round(VAT_SCAN_M_PER_PX / metres_per_px))
    affordable = math.sqrt((width_m * height_m) / VAT_MAX_SCAN_CELLS)
    return max(finest, math.ceil(affordable / metres_per_px), 1)


# --- operators -----------------------------------------------------------


def decimate(z: np.ndarray, factor: int) -> np.ndarray:
    """Mean over factor x factor blocks, NaN-aware, as horizonDecimation."""
    if factor == 1:
        return z
    h, w = z.shape
    h2, w2 = h // factor, w // factor
    blocks = (
        z[: h2 * factor, : w2 * factor]
        .reshape(h2, factor, w2, factor)
        .transpose(0, 2, 1, 3)
        .reshape(h2, w2, factor * factor)
    )
    with np.errstate(invalid="ignore"):
        return np.nanmean(blocks, axis=2).astype(np.float32)


def gradients(z: np.ndarray, metres_per_px: float):
    """Horn's 3x3, as in GDAL and Esri. NaN anywhere in the 3x3 poisons the cell."""
    dzdx = np.full(z.shape, np.nan, np.float32)
    dzdy = np.full(z.shape, np.nan, np.float32)
    denom = 8 * metres_per_px
    a, b, c = z[:-2, :-2], z[:-2, 1:-1], z[:-2, 2:]
    d, f = z[1:-1, :-2], z[1:-1, 2:]
    g, h, i = z[2:, :-2], z[2:, 1:-1], z[2:, 2:]
    dzdx[1:-1, 1:-1] = ((c + 2 * f + i) - (a + 2 * d + g)) / denom
    dzdy[1:-1, 1:-1] = ((g + 2 * h + i) - (a + 2 * b + c)) / denom
    return dzdx, dzdy


def hillshade(dzdx, dzdy, azimuth, altitude, z_factor):
    dx, dy = dzdx * z_factor, dzdy * z_factor
    slope = np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(dy, -dx)
    az = np.radians(360 - azimuth + 90)
    alt = np.radians(altitude)
    v = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(v, 0, 1)


def scan_horizon(z: np.ndarray, metres_per_px: float, radius_m: float, inner_m: float):
    """One ray walk read three ways: sky-view, positive and negative openness."""
    radius_px = min(SVF_MAX_RADIUS_PX, max(1, round(radius_m / metres_per_px)))
    inner_px = min(radius_px, max(1, round(inner_m / metres_per_px)))

    h, w = z.shape
    max_t = np.full((SVF_DIRECTIONS, h, w), np.nan, np.float32)
    min_t = np.full((SVF_DIRECTIONS, h, w), np.nan, np.float32)

    for d in range(SVF_DIRECTIONS):
        angle = 2 * math.pi * d / SVF_DIRECTIONS
        ux, uy = math.cos(angle), math.sin(angle)
        last = None
        for r in range(inner_px, radius_px + 1):
            dx, dy = int(round(ux * r)), int(round(uy * r))
            if (dx, dy) == last:
                continue  # near the origin, successive steps round to one cell
            last = (dx, dy)
            dist = math.hypot(dx, dy) * metres_per_px
            if dist == 0:
                continue
            shifted = np.full((h, w), np.nan, np.float32)
            ys0, ys1 = max(0, dy), min(h, h + dy)
            xs0, xs1 = max(0, dx), min(w, w + dx)
            yd0, yd1 = max(0, -dy), min(h, h - dy)
            xd0, xd1 = max(0, -dx), min(w, w - dx)
            if ys1 > ys0 and xs1 > xs0:
                shifted[yd0:yd1, xd0:xd1] = z[ys0:ys1, xs0:xs1]
            tan = (shifted - z) / dist
            max_t[d] = np.fmax(max_t[d], tan)
            min_t[d] = np.fmin(min_t[d], tan)

    max_t = np.nan_to_num(max_t, nan=0.0)
    min_t = np.nan_to_num(min_t, nan=0.0)
    above = np.maximum(max_t, 0.0)
    svf = (1 - above / np.hypot(1.0, above)).sum(0) / SVF_DIRECTIONS
    open_pos = (90 - np.degrees(np.arctan(max_t))).sum(0) / SVF_DIRECTIONS
    open_neg = (90 + np.degrees(np.arctan(min_t))).sum(0) / SVF_DIRECTIONS

    bad = np.isnan(z)
    for field in (svf, open_pos, open_neg):
        field[bad] = np.nan
    return (
        svf.astype(np.float32),
        open_pos.astype(np.float32),
        open_neg.astype(np.float32),
    )


def _norm(v, lo, hi):
    return np.clip((v - lo) / (hi - lo), 0, 1)


def _overlay(active, background):
    """rvt.blend_func.blend_overlay, which drives off the background."""
    return np.where(
        background > 0.5,
        1 - (1 - 2 * (background - 0.5)) * (1 - active),
        2 * background * active,
    )


def compose_vat(hs, slope_radians, open_pos_deg, svf, preset):
    """One preset's four VAT layers -> 0..1, no stretch needed downstream."""
    out = hs
    out = out * 0.5 + _norm(np.degrees(slope_radians), 0, preset["slopeMax"]) * 0.5
    out = _overlay(
        _norm(open_pos_deg, preset["opennessMin"], preset["opennessMax"]), out
    )
    out = out * (_norm(svf, preset["svfMin"], 1.0) * 0.25 + 0.75)
    return out


def vat(z: np.ndarray, metres_per_px: float) -> np.ndarray:
    """RVT's combined VAT: the general stack over the flat one, i.e. their mean.

    Result is 0..1 on absolute stretches, which is the property that makes VAT
    tile without a global stretch pass. Neither preset alone is offered.
    """
    dzdx, dzdy = gradients(z, metres_per_px)
    slope = np.arctan(np.hypot(dzdx, dzdy))
    stacks = []
    for name in ("general", "flat"):
        preset = VAT_PRESETS[name]
        svf, open_pos, _ = scan_horizon(
            z, metres_per_px, preset["radiusMetres"], preset["innerMetres"]
        )
        hs = hillshade(dzdx, dzdy, VAT_AZIMUTH, preset["sunAltitude"], VAT_Z_FACTOR)
        stacks.append(compose_vat(hs, slope, open_pos, svf, preset))
    combined = VAT_GENERAL_OPACITY * stacks[0] + (1 - VAT_GENERAL_OPACITY) * stacks[1]
    return combined.astype(np.float32)
