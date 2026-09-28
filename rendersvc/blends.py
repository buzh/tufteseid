"""RVT's own blended visualizations of one rectangle of float elevation.

e4MSTP today, a table of recipes for the next one. Not named `rvt.py`: a module
of that name in this directory shadows the installed `rvt` package.

Each recipe is transcribed from `rvt.blend` and built on `rvt.vis` and
`rvt.blend_func` alone, because `rvt.blend` and `rvt.default` import
`osgeo.gdal`. The transcription of e4MSTP was checked against
`rvt.blend.e4mstp` on real ground and is equal to the bit. Same trade, and the
same blend loop, as `vat-cache/cvat.py`.

RVT states its radii as pixel counts against a 0.5 m DEM, so they are scaled
here to hold their reach in metres whatever the acquisition publishes.

**Two grids.** A blend reads well outside the rectangle it draws: e4MSTP's
broad MSTP scale reaches 250 m, and given none, RVT pads `symmetric` and the
whole broad channel becomes a picture of the mirror. Fetching 250 m of real
ground on every side at 0.25 m would be a 4000 px grid, and `exportImage` sheds
those. So the broad scale is taken off a second, coarse grid that carries the
context, and resampled up: measured against full-resolution context that costs
a mean 0.005 of the finished pixel, where mirroring costs 0.087.
"""

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

# No band. A still is stamped in the reader's own tab at download time, so the
# stored file stays bare — which is the one the map lays back over the ground.
WANTS_LEGEND = False

# The resolution RVT's pixel radii were calibrated at.
CALIBRATION_M_PER_PX = 0.5

# rvt.default.DefaultValues, which is what rvt.blend.e4mstp is handed.
MSTP_LOCAL = (1, 5, 1)
MSTP_MESO = (5, 50, 5)
MSTP_BROAD = (50, 500, 50)
MSTP_LIGHTNESS = 0.9
SVF_N_DIR = 16
SVF_R_MAX = 10
SVF_NOISE = 0
# Stated in metres by e4mstp itself (`int(10 / resolution)`), not in pixels, so
# this one is not scaled.
FLAT_SVF_R_MAX_M = 10
FLAT_SVF_NOISE = 3
LD_MIN_RAD = 10
LD_MAX_RAD = 20
LD_RAD_INC = 1
LD_ANGULAR_RES = 15
LD_OBSERVER_H = 1.7

# What each stage of e4MSTP reads outside the rectangle, in metres.
E4MSTP_CONTEXT_M = MSTP_BROAD[1] * CALIBRATION_M_PER_PX
E4MSTP_MARGIN_M = max(
    MSTP_MESO[1] * CALIBRATION_M_PER_PX,
    LD_MAX_RAD * CALIBRATION_M_PER_PX,
    FLAT_SVF_R_MAX_M,
)

# A side, per fetch. `exportImage` is flaky above about this for an F32 grid —
# it answers 500 under its own 60 s timeout, and more so under load. The
# client's own ceiling (`MAX_DEM_PX_PER_SIDE`) is the same figure.
MAX_FETCH_PX = 2200

# The context grid's pixel size. Coarser than this and the broad scale's 25 m
# step is no longer resolved; finer buys nothing a 50-500 px radius can see.
COARSE_M_PER_PX = 0.5

# Of the rectangle, after the rim around each hole is written off. Same trade as
# `sunloop.MIN_COVERAGE`: below half, `empty` tells the reader more than a
# picture of the holes would.
MIN_COVERAGE = 0.5

# What a blend is handed. `coarse` is None where the recipe asked for no
# context; `margin_px` and `context_px` are the real ground around the
# rectangle in each grid, to be cropped off once the reading is done.
Grids = namedtuple(
    "Grids",
    "fine resolution margin_px coarse coarse_resolution context_px height width",
)


def _px(value, scale):
    return max(1, int(round(value * scale)))


def _scaled(triple, scale):
    """One of MSTP's (min, max, step) radii, in pixels at this resolution."""
    low, high, step = (_px(v, scale) for v in triple)
    return (low, max(high, low + step), max(1, step))


def _stack(layers):
    """RVT's own blend loop: bottom layer first, normalize, optional colour
    ramp, blend, opacity. Layers are listed top-first, the way RVT lists
    them."""
    rendered = None
    for vis, image, low, high, mode, opacity, cmap in reversed(layers):
        norm = normalize_image(vis, image, low, high, "value")
        if cmap is not None and image.ndim < 3:
            norm = gray_scale_to_color_ramp(
                norm, cmap, min_colormap_cut=0, max_colormap_cut=1, output_8bit=False
            )
        if rendered is None:
            rendered = norm
            continue
        rendered = render_images(blend_images(mode, norm, rendered), rendered, opacity)
    return rendered


def _resample(arr, height, width):
    """Bilinear, edges aligned: PIL resizes between the arrays' outer bounds, so
    a crop covering exactly the rectangle lands on exactly the rectangle."""
    return np.asarray(
        Image.fromarray(np.asarray(arr, dtype=np.float32)).resize(
            (width, height), Image.BILINEAR
        )
    )


def _e4mstp(g, log):
    """Enhanced version 4 Multi-scale topographic position: MSTP over combined
    sky-view factor, combined openness and local dominance, on a coloured slope.
    3 x height x width in 0..1."""
    scale = CALIBRATION_M_PER_PX / g.resolution
    crop = (
        slice(g.margin_px, g.margin_px + g.height),
        slice(g.margin_px, g.margin_px + g.width),
    )

    started = time.perf_counter()
    low, high, step = _scaled(MSTP_LOCAL, scale)
    local_dev = max_elevation_deviation(g.fine, low, high, step)[crop]
    low, high, step = _scaled(MSTP_MESO, scale)
    meso_dev = max_elevation_deviation(g.fine, low, high, step)[crop]
    coarse_height, coarse_width = (s - 2 * g.context_px for s in g.coarse.shape)
    low, high, step = _scaled(MSTP_BROAD, CALIBRATION_M_PER_PX / g.coarse_resolution)
    broad_dev = max_elevation_deviation(g.coarse, low, high, step)[
        g.context_px : g.context_px + coarse_height,
        g.context_px : g.context_px + coarse_width,
    ]
    # `rvt.vis.mstp`'s own composition, one scale at a time, because the three
    # scales come off two different grids and it takes only one.
    mstp_arr = np.asarray(
        [
            np.clip(1 - np.exp(-MSTP_LIGHTNESS * np.abs(dev)), 0, 1)
            for dev in (
                _resample(broad_dev, g.height, g.width),
                meso_dev,
                local_dev,
            )
        ]
    )
    del broad_dev, meso_dev, local_dev
    log(f"mstp {time.perf_counter() - started:.1f} s")

    started = time.perf_counter()
    horizon = sky_view_factor(
        g.fine,
        g.resolution,
        compute_svf=True,
        compute_opns=True,
        svf_n_dir=SVF_N_DIR,
        svf_r_max=_px(SVF_R_MAX, scale),
        svf_noise=SVF_NOISE,
    )
    svf_arr, opns_arr = horizon["svf"][crop], horizon["opns"][crop]
    del horizon
    neg_opns = sky_view_factor(
        -g.fine,
        g.resolution,
        compute_svf=False,
        compute_opns=True,
        svf_n_dir=SVF_N_DIR,
        svf_r_max=_px(SVF_R_MAX, scale),
        svf_noise=SVF_NOISE,
    )["opns"][crop]
    svf_flat = sky_view_factor(
        g.fine,
        g.resolution,
        compute_svf=True,
        compute_opns=False,
        svf_n_dir=SVF_N_DIR,
        svf_r_max=max(1, int(FLAT_SVF_R_MAX_M / g.resolution)),
        svf_noise=FLAT_SVF_NOISE,
    )["svf"][crop]
    log(f"horizon {time.perf_counter() - started:.1f} s")

    started = time.perf_counter()
    ld_arr = local_dominance(
        g.fine,
        min_rad=_px(LD_MIN_RAD, scale),
        max_rad=_px(LD_MAX_RAD, scale),
        rad_inc=LD_RAD_INC,
        angular_res=LD_ANGULAR_RES,
        observer_height=LD_OBSERVER_H,
    )[crop]
    log(f"local dominance {time.perf_counter() - started:.1f} s")

    # Radians, and normalized below over 0..55. That is what `rvt.blend.e4mstp`
    # does — it calls `slope_aspect` without `output_units` — so the layer is
    # all but a flat dark red, and the blend's colour comes from it. Handing it
    # degrees would be a different picture under the same name.
    slope = slope_aspect(
        g.fine, resolution_x=g.resolution, resolution_y=g.resolution
    )["slope"][crop]

    started = time.perf_counter()
    comb_svf = _stack(
        [
            ("Sky-view factor", svf_arr, 0.7, 1.0, "normal", 50, None),
            ("Sky-view factor", svf_flat, 0.9, 1.0, "normal", 100, None),
        ]
    ).astype("float32")
    comb_ol = _stack(
        [
            ("Openness difference", opns_arr - neg_opns, -15, 15, "normal", 50, None),
            ("Local dominance", ld_arr, 0.5, 1.8, "normal", 100, None),
        ]
    ).astype("float32")
    out = _stack(
        [
            ("mstp", mstp_arr, 0, 1, "overlay", 90, None),
            ("Comb svf", comb_svf, -0.5, 0.5, "multiply", 25, None),
            ("Comb openness LD", comb_ol, 0, 1, "multiply", 100, None),
            ("Slope gradient", slope, 0, 55, "normal", 100, "Reds_r"),
        ]
    )
    log(f"blend {time.perf_counter() - started:.1f} s")
    return out


# Keyed by `meta.vis`. `margin_m` is real ground fetched around the rectangle at
# the render's own resolution; `context_m` the same at `COARSE_M_PER_PX`, for a
# scale too broad to fetch finely, and 0 for a recipe that needs no second grid.
PRODUCERS = {
    "e4mstp": {
        "margin_m": E4MSTP_MARGIN_M,
        "context_m": E4MSTP_CONTEXT_M,
        "blend": _e4mstp,
    },
}


def spec_of(meta):
    """The stored parameters, read back rather than trusted. Mirrors the `rvt`
    arm of `specOf` in `src/evidence/spec.ts`."""
    if not isinstance(meta, dict):
        raise ValueError("meta is not an object")
    vis = meta.get("vis")
    model = meta.get("model")
    if vis not in PRODUCERS:
        raise ValueError("no such visualization")
    if model not in ("dtm", "dom"):
        raise ValueError("model is neither dtm nor dom")
    return {"vis": vis, "model": model}


def _fetch(model, bbox25833, res_x, res_y, width, height, pad_px):
    """The rectangle with `pad_px` of real ground around it, at that pixel
    size."""
    pad_x, pad_y = pad_px * res_x, pad_px * res_y
    return dem_source.fetch_grid(
        model,
        [
            bbox25833[0] - pad_x,
            bbox25833[1] - pad_y,
            bbox25833[2] + pad_x,
            bbox25833[3] + pad_y,
        ],
        width + 2 * pad_px,
        height + 2 * pad_px,
    )


def render(spec, bbox25833, legend_content, log):
    """(blob, filename, content_type, meta), or None where the ground has too
    little laser data to be worth a picture — which is an answer about the
    ground rather than a fault, though not one that settles the question."""
    recipe = PRODUCERS[spec["vis"]]
    model = spec["model"]
    width_m = bbox25833[2] - bbox25833[0]
    height_m = bbox25833[3] - bbox25833[1]

    try:
        native = dem_source.probe_coverage(model, bbox25833)
    except Exception as e:
        # A probe that fails is not an absence; fall through at the finest the
        # services publish and let the pixels answer.
        log(f"coverage probe failed, assuming {dem_source.FINEST_M_PER_PX} m: {e}")
        native = dem_source.FINEST_M_PER_PX
    if native is None:
        return None

    margin_m = recipe["margin_m"]
    # The margin is fetched too, so what the fetch ceiling bounds is the whole
    # grid rather than the picture.
    metres_per_px = max(native, (max(width_m, height_m) + 2 * margin_m) / MAX_FETCH_PX)
    width = round(width_m / metres_per_px)
    if width < 2:
        return None
    # What the pixels actually are, after the rounding. The height follows from
    # that one figure rather than from its own rounding, and the rectangle is
    # then trimmed to the grid about its centre: `slope_aspect` is told
    # `resolution_x == resolution_y`, so square pixels have to be a fact rather
    # than an assumption for a footprint whose two sides round differently.
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
        model, bbox25833, metres_per_px, metres_per_px, width, height, margin_px
    )
    crop = (slice(margin_px, margin_px + height), slice(margin_px, margin_px + width))
    # rvt restores the input's NaN mask onto its output, so a hole is never
    # drawn larger than it is — but its derivative substitutes a pixel's own
    # value for a NaN neighbour (`roll_fill_nans`), which halves the gradient
    # all round the rim. Dilating writes that invented ring off with the hole.
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

    # Transparent where there is nothing to draw, the way the browser producers
    # leave a hole: a PNG carries the alpha channel a WebM could not.
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
