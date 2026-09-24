"""The sun walked all the way round one rectangle of shaded relief.

RVT does the shading. `slope_aspect` runs once on a 1-px-padded grid and every
azimuth reuses it through `hillshade`'s own `slope`/`aspect` parameters — which
is why the vertical exaggeration is applied there and not on `hillshade`: given
slope and aspect, `hillshade` never touches the DEM again and its own
`ve_factor` does nothing. Verified equal to the plain call.

`byte_scale` is given a fixed 0..1 rather than its default per-array stretch, or
every frame would be scaled to its own extremes and the loop would pump.
"""

import subprocess
import tempfile
import time
from datetime import datetime, timezone

import numpy as np
from rvt.vis import byte_scale, hillshade, slope_aspect

import dem as dem_source
import legend

# A video budget, not a DEM limit: a 500 m footprint at 0.25 m would be 2000 px
# a side and 72 frames of it is a lot of bytes for a loop.
MAX_FRAME_PX = 1600

# Ground fetched outside the rectangle and cropped off, so the gradient at the
# edge is taken against real ground. A hillshade reaches one pixel.
MARGIN_PX = 4

FPS_DEFAULT = 24
STEP_DEG_DEFAULT = 5

# The evidence file field's ceiling. Over it PocketBase answers 400, and it
# answers the same to every retry of the same bytes.
MAX_FILE_BYTES = 50000000
CRF_LADDER = (32, 40, 48)

ENCODE_TIMEOUT_S = 900


def _even(n):
    return int(n) - (int(n) % 2)


def render(spec, bbox25833, legend_content, log):
    """(blob, filename, content_type, meta), or None where the ground has no
    laser data — which is not a failure and nothing a retry would change."""
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

    metres_per_px = max(native, max(width_m, height_m) / MAX_FRAME_PX)
    width = _even(round(width_m / metres_per_px))
    height = _even(round(height_m / metres_per_px))
    if width < 2 or height < 2:
        return None
    # What the pixels actually are, after the rounding to an even count.
    metres_per_px = width_m / width

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
    )
    if not dem_source.has_values(grid):
        return None
    log(f"dem {grid.shape[1]}x{grid.shape[0]} at {metres_per_px:.3f} m/px")

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
    crop = slice(MARGIN_PX, -MARGIN_PX) if MARGIN_PX else slice(None)
    band = legend.compose(width, height, legend_content, metres_per_px)

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
        if band:
            legend.apply(frame, band)
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
        "frames": len(frames),
        "durationMs": round(len(frames) * 1000 / fps),
        "renderedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    return blob, f"solrunde_{model}.webm", "video/webm", meta


def _encode(frames, fps, crf):
    """Raw grey straight into ffmpeg: no PNG round trip and no frame files. The
    output goes to a real file because a WebM written to a pipe cannot be
    seeked back to for its cues."""
    height, width = frames[0].shape
    with tempfile.NamedTemporaryFile(suffix=".webm") as out:
        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "gray",
            "-s", f"{width}x{height}", "-r", str(fps), "-i", "-",
            "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p",
            "-crf", str(crf), "-b:v", "0",
            "-row-mt", "1", "-deadline", "good", "-cpu-used", "2",
            # One GOP: the loop is played whole and never seeked into.
            "-g", str(len(frames)),
            "-an", "-f", "webm", out.name,
        ]
        process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stderr=subprocess.PIPE
        )
        try:
            for frame in frames:
                process.stdin.write(frame.tobytes())
            process.stdin.close()
        except BrokenPipeError:
            pass
        _, err = process.communicate(timeout=ENCODE_TIMEOUT_S)
        if process.returncode != 0:
            raise RuntimeError(f"ffmpeg: {err.decode('utf-8', 'replace')[:500]}")
        out.seek(0)
        return out.read()
