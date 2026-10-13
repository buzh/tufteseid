
import time
from collections import namedtuple
from datetime import datetime, timezone
from io import BytesIO

import numpy as np
from PIL import Image
from rvt.blend_func import (
    blend_images,
    gray_scale_to_color_ramp,
    normalize_image,
    render_images,
)
from rvt.vis import local_dominance, max_elevation_deviation, sky_view_factor, slope_aspect
from scipy.ndimage import binary_dilation

import dem as dem_source

KIND = "rvt"

WANTS_LEGEND = False

CALIBRATION_M_PER_PX = 0.5

MSTP_LOCAL = (1, 5, 1)
MSTP_MESO = (5, 50, 5)
MSTP_BROAD = (50, 500, 50)
MSTP_LIGHTNESS = 0.9
SVF_N_DIR = 16
SVF_R_MAX = 10
SVF_NOISE = 0

FLAT_SVF_R_MAX_M = 10
FLAT_SVF_NOISE = 3
LD_MIN_RAD = 10
LD_MAX_RAD = 20
LD_RAD_INC = 1
LD_ANGULAR_RES = 15
LD_OBSERVER_H = 1.7

E4MSTP_CONTEXT_M = MSTP_BROAD[1] * CALIBRATION_M_PER_PX
E4MSTP_MARGIN_M = max(
    MSTP_MESO[1] * CALIBRATION_M_PER_PX,
    LD_MAX_RAD * CALIBRATION_M_PER_PX,
    FLAT_SVF_R_MAX_M,
)

MAX_FETCH_PX = 2200

COARSE_M_PER_PX = 0.5

MIN_COVERAGE = 0.5

Grids = namedtuple(
    "Grids",
    "fine resolution margin_px coarse coarse_resolution context_px height width",
)

def _px(value, scale):
    return max(1, int(round(value * scale)))

def _scaled(triple, scale):
    low, high, step = (_px(v, scale) for v in triple)
    return (low, max(high, low + step), max(1, step))

def _stack(layers):
    a crop covering exactly the rectangle lands on exactly the rectangle."""
    return np.asarray(
        Image.fromarray(np.asarray(arr, dtype=np.float32)).resize(
            (width, height), Image.BILINEAR
        )
    )

def _e4mstp(g, log):
    arm of `specOf` in `src/evidence/spec.ts`."""
    if not isinstance(meta, dict):
        raise ValueError("meta is not an object")
    vis = meta.get("vis")
    model = meta.get("model")
    if vis not in PRODUCERS:
        raise ValueError("no such visualization")
    if model not in ("dtm", "dom"):
        raise ValueError("model is neither dtm nor dom")
    return {"vis": vis, "model": model, "project": dem_source.project_of(meta)}

def _fetch(model, bbox25833, res_x, res_y, width, height, pad_px, log, project):
    little laser data to be worth a picture — which is an answer about the
    ground rather than a fault, though not one that settles the question."""
    recipe = PRODUCERS[spec["vis"]]
    model = spec["model"]
    project = spec["project"]
    width_m = bbox25833[2] - bbox25833[0]
    height_m = bbox25833[3] - bbox25833[1]

    try:
        native = dem_source.probe_coverage(model, bbox25833, project)
    except Exception as e:

        log(f"coverage probe failed, assuming {dem_source.FINEST_M_PER_PX} m: {e}")
        native = dem_source.FINEST_M_PER_PX
    if native is None:
        return None

    margin_m = recipe["margin_m"]

    metres_per_px = max(native, (max(width_m, height_m) + 2 * margin_m) / MAX_FETCH_PX)
    width = round(width_m / metres_per_px)
    if width < 2:
        return None

    metres_per_px = width_m / width
    height = round(height_m / metres_per_px)
    if height < 2:
        return None
    centre_y = (bbox25833[1] + bbox25833[3]) / 2
    half_m = height * metres_per_px / 2
    bbox25833 = [
        round(bbox25833[0], 3),
        round(centre_y - half_m, 3),
        round(bbox25833[2], 3),
        round(centre_y + half_m, 3),
    ]

    margin_px = max(1, int(np.ceil(margin_m / metres_per_px)))
    started = time.perf_counter()
    fine = _fetch(
        model,
        bbox25833,
        metres_per_px,
        metres_per_px,
        width,
        height,
        margin_px,
        log,
        project,
    )
    crop = (slice(margin_px, margin_px + height), slice(margin_px, margin_px + width))

    absent = binary_dilation(~np.isfinite(fine))[crop]
    coverage = 1 - float(absent.mean())
    log(
        f"dem {width}x{height} at {metres_per_px:.3f} m/px, {coverage:.1%} covered, "
        f"fetched in {time.perf_counter() - started:.1f} s"
    )
    if coverage < MIN_COVERAGE:
        return None

    coarse = None
    coarse_resolution = metres_per_px
    context_px = 0
    context_m = recipe["context_m"]
    if context_m:
        coarse_resolution = max(
            metres_per_px,
            COARSE_M_PER_PX,
            (max(width_m, height_m) + 2 * context_m) / MAX_FETCH_PX,
        )
        context_px = int(np.ceil(context_m / coarse_resolution))
        coarse_width = max(1, round(width_m / coarse_resolution))
        coarse_height = max(1, round(height_m / coarse_resolution))
        started = time.perf_counter()
        coarse = _fetch(
            model,
            bbox25833,
            width_m / coarse_width,
            height_m / coarse_height,
            coarse_width,
            coarse_height,
            context_px,
            log,
            project,
        )
        log(
            f"context {coarse.shape[1]}x{coarse.shape[0]} at "
            f"{coarse_resolution:.3f} m/px in {time.perf_counter() - started:.1f} s"
        )

    rgb = np.asarray(
        recipe["blend"](
            Grids(
                fine=fine,
                resolution=metres_per_px,
                margin_px=margin_px,
                coarse=coarse,
                coarse_resolution=coarse_resolution,
                context_px=context_px,
                height=height,
                width=width,
            ),
            log,
        )
    )
    del fine, coarse

    absent |= ~np.isfinite(rgb).all(axis=0)
    pixels = np.moveaxis(
        np.clip(np.nan_to_num(rgb, nan=0.0) * 255, 0, 255).astype(np.uint8), 0, -1
    )
    alpha = np.where(absent, 0, 255).astype(np.uint8)
    buffer = BytesIO()
    Image.fromarray(np.dstack((pixels, alpha)), mode="RGBA").save(buffer, format="PNG")

    meta = {
        "metresPerPx": round(metres_per_px, 4),
        "bbox25833": bbox25833,
        "coverage": round(coverage, 3),
        "renderedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    return buffer.getvalue(), f"{spec['vis']}_{model}.png", "image/png", meta
