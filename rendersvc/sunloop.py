
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone

import numpy as np
from rvt.vis import byte_scale, hillshade, slope_aspect
from scipy.ndimage import binary_dilation

import dem as dem_source
import legend

MAX_FRAME_PX = 1600

MARGIN_PX = 4

FPS_DEFAULT = 24
STEP_DEG_DEFAULT = 5

KIND = "sunloop"

WANTS_LEGEND = True

NO_DATA_VALUE = 128

MIN_COVERAGE = 0.5

MAX_FILE_BYTES = 50000000
CRF_LADDER = (32, 40, 48)

ENCODE_TIMEOUT_S = 900

def _even(n):
    return int(n) - (int(n) % 2)

def _number(value, low, high):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    return float(value) if low <= value <= high else None

def spec_of(meta):
    little laser data to be worth a picture — which is an answer about the
    ground rather than a fault, though not one that settles the question."""
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

    metres_per_px = max(native, max(width_m, height_m) / MAX_FRAME_PX)
    width = _even(round(width_m / metres_per_px))
    if width < 2:
        return None

    metres_per_px = width_m / width
    height = _even(round(height_m / metres_per_px))
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

    margin_m = MARGIN_PX * metres_per_px
    grid = dem_source.fetch_grid(
        model,
        [
            bbox25833[0] - margin_m,
            bbox25833[1] - margin_m,
            bbox25833[2] + margin_m,
            bbox25833[3] + margin_m,
        ],
        width + 2 * MARGIN_PX,
        height + 2 * MARGIN_PX,
        log,
        project,
    )
    crop = slice(MARGIN_PX, -MARGIN_PX) if MARGIN_PX else slice(None)

    absent = binary_dilation(~np.isfinite(grid))[crop, crop]
    coverage = 1 - float(absent.mean())
    if coverage < MIN_COVERAGE:
        return None
    log(
        f"dem {grid.shape[1]}x{grid.shape[0]} at {metres_per_px:.3f} m/px, "
        f"{coverage:.1%} covered"
    )

    step = int(spec.get("stepDeg") or STEP_DEG_DEFAULT)
    fps = int(spec.get("fps") or FPS_DEFAULT)
    azimuths = list(range(0, 360, step))

    started = time.perf_counter()
    padded = np.pad(grid, 1, mode="edge")
    sa = slope_aspect(
        padded,
        resolution_x=metres_per_px,
        resolution_y=metres_per_px,
        output_units="radian",
        ve_factor=spec["zFactor"],
    )
    band = legend.compose(width, height, legend_content, metres_per_px)
    frame_h = height + (0 if band is None else band.shape[0])

    frames = []
    for azimuth in azimuths:
        shaded = hillshade(
            grid,
            metres_per_px,
            metres_per_px,
            sun_azimuth=azimuth,
            sun_elevation=spec["altitude"],
            slope=sa["slope"],
            aspect=sa["aspect"],
        )
        frame = byte_scale(shaded[crop, crop], c_min=0, c_max=1)
        frame = np.ascontiguousarray(frame)
        frame[absent] = NO_DATA_VALUE
        if band is not None:
            frame = np.vstack((frame, band))
        frames.append(frame)
    log(f"{len(frames)} frames in {time.perf_counter() - started:.1f} s")

    blob = None
    for crf in CRF_LADDER:
        started = time.perf_counter()
        blob = _encode(frames, fps, crf)
        log(f"crf {crf}: {len(blob) / 1e6:.1f} MB in {time.perf_counter() - started:.1f} s")
        if len(blob) <= MAX_FILE_BYTES:
            break
    if len(blob) > MAX_FILE_BYTES:
        raise RuntimeError(f"{len(blob)} bytes will not fit the file field")

    meta = {
        "metresPerPx": round(metres_per_px, 4),
        "bbox25833": bbox25833,

        "bandTop": round(height / frame_h, 5),
        "coverage": round(coverage, 3),
        "frames": len(frames),
        "durationMs": round(len(frames) * 1000 / fps),
        "renderedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    return blob, f"solrunde_{model}.webm", "video/webm", meta

def _encode(frames, fps, crf):