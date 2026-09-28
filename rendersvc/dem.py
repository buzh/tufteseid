"""Float elevation out of hoydedata.no for one rectangle.

The endpoint's quirks are `docs/terrain-analysis.md`; this is the server-side
twin of `src/terrain/dem.ts`, minus the tiling. A caller asks for one grid and
gets one `exportImage`; where that would be too large a grid — about 2200 px a
side for F32, past which the service answers 500 under its own timeout — it is
the caller that coarsens.

Straight to hoydedata.no, never through wmscache: every job is a rectangle
nobody will ask for again, so caching it only evicts tiles that are re-read.
"""

import json
import random
import time
import urllib.parse
import urllib.request

from pyproj import Transformer

# The float TIFF reader is shared with `vat-cache/`, copied into the image by
# the Dockerfile. Its treatment of absent tiles is load-bearing here too.
from fetch_dem import read_tiff_f32

BASE = "https://hoydedata.no/arcgis/rest/services"

# Per-acquisition mosaics, not the national NHM_* ones: where NHM never flew,
# the national catalogue silently serves 10 m contour-derived rows upsampled.
SERVICES = {"dtm": "Prosjekt_DTM", "dom": "Prosjekt_DOM"}

# Finest acquisition wins where they overlap. Stated explicitly because
# Prosjekt_DOM defaults to a Northwest mosaic method and Prosjekt_DTM does not.
MOSAIC_RULE = json.dumps(
    {"mosaicMethod": "esriMosaicAttribute", "sortField": "lowps", "sortValue": 0}
)

# Finest resolution the per-project services publish.
FINEST_M_PER_PX = 0.25

# No retry, and short: a probe that fails costs the render nothing but this,
# because the fall-through assumes the finest resolution the services publish.
# Erring that way asks for more pixels than the ground has, never fewer.
PROBE_TIMEOUT_S = 20

# One attempt. `urlopen`'s timeout is the socket's, so this bounds how long the
# service may go silent rather than how long the transfer may take — which is
# the right thing to be patient about: ArcGIS composes the whole mosaic before
# it sends a byte, and a 2200 px F32 grid has been measured at 134 s of that on
# a busy afternoon. Cutting a grid off for being slow buys nothing at all, since
# the retry starts from the beginning against the same service.
FETCH_TIMEOUT_S = 600
# Every attempt at one grid, together. The picture is never made coarser to fit
# a struggling upstream, so patience is the only thing left to spend — bounded
# here, because the worker is serial and the queue behind it is real. A blend
# fetches two grids and so may spend twice this.
FETCH_BUDGET_S = 900
# exportImage answers a burst with a text body under a 200 status, and that
# recovers on its own in seconds. Real load does not, and hammering is how a
# slow minute becomes a slow hour — so the wait grows, with jitter, and the
# attempts are capped as well as the budget.
MAX_ATTEMPTS = 6
BACKOFF_CAP_S = 60

_to_metric = Transformer.from_crs("EPSG:4326", "EPSG:25833", always_xy=True)


def to_metric(bbox4326):
    """[west, south, east, north] to EPSG:25833. All four corners, bounded, the
    way OpenLayers' `transformExtent` does it, so the client's rectangle and
    this one are the same rectangle."""
    west, south, east, north = bbox4326
    xs, ys = _to_metric.transform(
        [west, east, west, east], [south, south, north, north]
    )
    return [min(xs), min(ys), max(xs), max(ys)]


def _get(url, timeout):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.read()


def probe_coverage(model, bbox25833):
    """Finest OPPLOSNING in metres over the rectangle, or None where the
    catalogue holds no laser data. Raises when the probe itself fails, which is
    not the same answer and must not read as an absence."""
    query = {
        "f": "json",
        "geometry": json.dumps(
            {
                "xmin": bbox25833[0],
                "ymin": bbox25833[1],
                "xmax": bbox25833[2],
                "ymax": bbox25833[3],
                "spatialReference": {"wkid": 25833},
            }
        ),
        "geometryType": "esriGeometryEnvelope",
        "inSR": 25833,
        "spatialRel": "esriSpatialRelIntersects",
        # The 10 m fallback rows have no OPPLOSNING, so excluding them makes a
        # null answer mean "no laser data".
        "where": "OPPLOSNING IS NOT NULL",
        "outStatistics": json.dumps(
            [
                {
                    "statisticType": "min",
                    "onStatisticField": "OPPLOSNING",
                    "outStatisticFieldName": "best",
                }
            ]
        ),
        "returnGeometry": "false",
    }
    url = (
        f"{BASE}/{SERVICES[model]}/ImageServer/query?"
        + urllib.parse.urlencode(query)
    )
    body = json.loads(_get(url, PROBE_TIMEOUT_S))
    if body.get("error"):
        raise RuntimeError(f"catalogue query rejected: {body['error']}")
    # The service upper-cases outStatisticFieldName, and no coverage arrives as
    # one feature with a null statistic, not as an empty features array.
    features = body.get("features") or [{}]
    attrs = features[0].get("attributes") or {}
    best = attrs.get("BEST", attrs.get("best"))
    if not isinstance(best, (int, float)) or not best > 0:
        return None
    return float(best)


def _slow(e):
    """A service that never answered, rather than one that answered badly.
    `urlopen` hands the socket's `TimeoutError` back inside a `URLError`."""
    return isinstance(e, TimeoutError) or isinstance(
        getattr(e, "reason", None), TimeoutError
    )


def fetch_grid(model, bbox25833, width, height, log=None):
    """(height, width) float32, metres above the vertical datum, north-up. NaN
    where no acquisition covers the pixel. Raises rather than answering with
    less than was asked for: a grid is the picture's resolution, and a caller
    that cannot have it wants the row retried, not quietly coarsened."""
    query = {
        "f": "image",
        "bbox": ",".join(str(v) for v in bbox25833),
        "bboxSR": 25833,
        "imageSR": 25833,
        "size": f"{width},{height}",
        "format": "tiff",
        "pixelType": "F32",
        "interpolation": "RSP_BilinearInterpolation",
        # rasterFunction 'None' returns values; the service's other function,
        # `skyggerelieff`, returns a shaded image.
        "renderingRule": json.dumps({"rasterFunction": "None"}),
        "mosaicRule": MOSAIC_RULE,
    }
    url = (
        f"{BASE}/{SERVICES[model]}/ImageServer/exportImage?"
        + urllib.parse.urlencode(query)
    )

    started = time.monotonic()
    deadline = started + FETCH_BUDGET_S
    last = None
    attempt = 0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        left = deadline - time.monotonic()
        if left <= 0:
            break
        try:
            buf = _get(url, min(FETCH_TIMEOUT_S, left))
            if buf[:2] not in (b"II", b"MM"):
                raise RuntimeError(f"not an image: {buf[:300]!r}")
            return read_tiff_f32(buf)
        except (OSError, RuntimeError, ValueError) as e:
            last = e
        if log:
            log(f"{width}x{height} attempt {attempt} failed: {last}")
        # A timeout has already done the waiting, and waiting again only spends
        # budget that would hold the next connection open instead.
        wait = (
            0
            if _slow(last)
            else min(BACKOFF_CAP_S, 2**attempt) * (0.5 + random.random())
        )
        if time.monotonic() + wait >= deadline:
            break
        time.sleep(wait)
    raise RuntimeError(
        f"exportImage failed {attempt} times in "
        f"{time.monotonic() - started:.0f} s at {width}x{height}: {last}"
    )
