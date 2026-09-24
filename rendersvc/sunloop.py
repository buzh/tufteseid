"""The sun walked all the way round one rectangle of shaded relief.

RVT does the shading. `slope_aspect` runs once on a 1-px-padded grid and every
azimuth reuses it through `hillshade`'s own `slope`/`aspect` parameters — which
is why the vertical exaggeration is applied there and not on `hillshade`: given
slope and aspect, `hillshade` never touches the DEM again and its own
`ve_factor` does nothing. Verified equal to the plain call.

`byte_scale` is given a fixed 0..1 rather than its default per-array stretch, or
every frame would be scaled to its own extremes and the loop would pump.

Absence is stamped on afterwards. `byte_scale` turns a NaN into 255, which is
pure white and reads as fully lit ground, so the holes are painted over the
finished frame instead.
"""

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

# A video budget, not a DEM limit: a 500 m footprint at 0.25 m would be 2000 px
# a side and 72 frames of it is a lot of bytes for a loop.
MAX_FRAME_PX = 1600

# Ground fetched outside the rectangle and cropped off, so the gradient at the
# edge is taken against real ground. A hillshade reaches one pixel.
MARGIN_PX = 4

FPS_DEFAULT = 24
STEP_DEG_DEFAULT = 5

# What a pixel with no laser data is painted. A WebM in yuv420p carries no alpha
# channel, so the browser producers' "no-data is transparent" is not available
# here and absence has to be a grey a reader cannot read as terrain. Not 0 and
# not 255: hillshade saturates at both ends, so whole slopes come out black and
# fully lit faces come out white in any honest frame. Mid grey appears only as a
# gradient value, never as a flat field, and it stays put while the sun turns.
NO_DATA_VALUE = 128

# Of the rectangle, after the rim around each hole is written off. Below half the
# square the loop is a picture of its own holes, and the reader is better served
# by `empty` — which says the ground has no laser data and offers no retry — than
# by a frame of mid grey with terrain in one corner.
MIN_COVERAGE = 0.5

# The evidence file field's ceiling. Over it PocketBase answers 400, and it
# answers the same to every retry of the same bytes.
MAX_FILE_BYTES = 50000000
CRF_LADDER = (32, 40, 48)

ENCODE_TIMEOUT_S = 900


def _even(n):
    return int(n) - (int(n) % 2)


def render(spec, bbox25833, legend_content, log):
    """(blob, filename, content_type, meta), or None where the ground has too
    little laser data to be worth a picture — which is not a failure and nothing
    a retry would change."""
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
    if width < 2:
        return None
    # What the pixels actually are, after the rounding to an even count. The
    # height follows from that one figure rather than from its own rounding,
    # because `slope_aspect` is told resolution_x == resolution_y and the scale
    # bar is drawn from it: square pixels have to be a fact, not an assumption.
    metres_per_px = width_m / width
    height = _even(round(height_m / metres_per_px))
    if height < 2:
        return None
    # So the rectangle is trimmed to the pixel grid about its centre, sub-pixel
    # and well inside the slack MAX_SIDE_M already allows, and what is fetched is
    # what `meta` reports.
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
    )
    crop = slice(MARGIN_PX, -MARGIN_PX) if MARGIN_PX else slice(None)
    # rvt 2.2.3 restores the input's NaN mask onto its output, so a hole is never
    # drawn larger than it is — but its derivative substitutes a pixel's own value
    # for a NaN neighbour (`roll_fill_nans`), which halves the gradient all round
    # the rim. Dilating by that four-neighbour stencil writes the invented ring
    # off with the hole. The mask is the ground's, so it serves every azimuth.
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
        "coverage": round(coverage, 3),
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
    with tempfile.NamedTemporaryFile(suffix=".webm") as out, tempfile.TemporaryFile() as err:
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
        # stderr to a file, never a pipe: ~180 MB of raw frames takes minutes to
        # feed and nothing here can drain a pipe meanwhile, so an ffmpeg blocked
        # on a full stderr would stop reading stdin and wedge both ends.
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=err)
        # The deadline covers the feed as well as the wait, so it is a timer that
        # kills the child rather than a timeout on the wait at the end.
        expired = threading.Event()

        def give_up():
            expired.set()
            process.kill()

        watchdog = threading.Timer(ENCODE_TIMEOUT_S, give_up)
        watchdog.start()
        try:
            try:
                for frame in frames:
                    process.stdin.write(frame.tobytes())
            except BrokenPipeError:
                # ffmpeg leaving early is not itself the error; the code is.
                pass
            finally:
                try:
                    process.stdin.close()
                except OSError:
                    pass
            process.wait()
        finally:
            watchdog.cancel()
            process.kill()
            process.wait()

        # The return code as well as the flag: a timer that fires between a
        # finished wait and the cancel below has killed nothing.
        if expired.is_set() and process.returncode != 0:
            raise RuntimeError(f"ffmpeg killed after {ENCODE_TIMEOUT_S} s")
        if process.returncode != 0:
            # The child wrote through its own dup of this descriptor, so the
            # offset shared with it is at the end of what it logged.
            err.seek(0)
            raise RuntimeError(f"ffmpeg: {err.read().decode('utf-8', 'replace')[:500]}")
        out.seek(0)
        return out.read()
