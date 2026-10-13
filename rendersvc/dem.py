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
import re
import time
import urllib.parse
import urllib.request

from pyproj import Transformer

from fetch_dem import read_tiff_f32

BASE = "https://hoydedata.no/arcgis/rest/services"

SERVICES = {"dtm": "Prosjekt_DTM", "dom": "Prosjekt_DOM"}

MOSAIC_RULE = {
    "mosaicMethod": "esriMosaicAttribute",
    "sortField": "lowps",
    "sortValue": 0,
}

AUTO_SOURCE = "auto"

LASER_ONLY = "OPPLOSNING IS NOT NULL"

_NAME = re.compile(r"^[\w .,()\-/]{1,200}$")


def project_of(meta):
    """The acquisition `meta` names, or None for the mosaic. Raises on a name
    the catalogue filter may not carry, which the route answers 422."""
    source = meta.get("source", AUTO_SOURCE)
    if source is None or source == AUTO_SOURCE:
        return None
    if not isinstance(source, str) or not _NAME.match(source):
        raise ValueError("source is not an acquisition name")
    return source


def _only(project):
    """The catalogue filter for one acquisition, as a `where` fragment."""
    return f"LAS_PROJECT_NAME = '{project}'"


def _mosaic_rule(project):
    """Which rasters may answer. With no project this is the finest-wins
    mosaic; with one, that acquisition alone — the finest of its own tiles,
    which is the same rule over a smaller catalogue."""
    rule = dict(MOSAIC_RULE)
    if project:
        rule["where"] = _only(project)
    return json.dumps(rule)

FINEST_M_PER_PX = 0.25

PROBE_TIMEOUT_S = 20

FETCH_TIMEOUT_S = 600
FETCH_BUDGET_S = 900
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


def probe_coverage(model, bbox25833, project=None):
    """Finest OPPLOSNING in metres over the rectangle, or None where the
    catalogue holds no laser data — none of this acquisition's, where one is
    named. Raises when the probe itself fails, which is not the same answer and
    must not read as an absence."""
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
        "where": LASER_ONLY + (f" AND {_only(project)}" if project else ""),
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


def fetch_grid(model, bbox25833, width, height, log=None, project=None):
    """(height, width) float32, metres above the vertical datum, north-up. NaN
    where no acquisition covers the pixel — where the named one does not, with
    a project. Raises rather than answering with less than was asked for: a
    grid is the picture's resolution, and a caller that cannot have it wants
    the row retried, not quietly coarsened."""
    query = {
        "f": "image",
        "bbox": ",".join(str(v) for v in bbox25833),
        "bboxSR": 25833,
        "imageSR": 25833,
        "size": f"{width},{height}",
        "format": "tiff",
        "pixelType": "F32",
        "interpolation": "RSP_BilinearInterpolation",
        "renderingRule": json.dumps({"rasterFunction": "None"}),
        "mosaicRule": _mosaic_rule(project),
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
