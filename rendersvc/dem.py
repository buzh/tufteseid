"""Float elevation out of hoydedata.no for one rectangle.

The endpoint's quirks are `docs/terrain-analysis.md`; this is the server-side
twin of `src/terrain/dem.ts`, minus the tiling — the per-project services cap at
15 000 px a side and a footprint is 500 m, so one call always covers it.

Straight to hoydedata.no, never through wmscache: every job is a rectangle
nobody will ask for again, so caching it only evicts tiles that are re-read.
"""

import json
import time
import urllib.parse
import urllib.request

import numpy as np
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

PROBE_TIMEOUT_S = 20
FETCH_TIMEOUT_S = 180
# exportImage answers a burst with a text body under a 200 status. This is the
# step that fails, and it recovers on its own.
FETCH_RETRIES = 5

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


def fetch_grid(model, bbox25833, width, height):
    """(height, width) float32, metres above the vertical datum, north-up. NaN
    where no acquisition covers the pixel."""
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

    last = None
    for attempt in range(FETCH_RETRIES):
        try:
            buf = _get(url, FETCH_TIMEOUT_S)
            if buf[:2] not in (b"II", b"MM"):
                raise RuntimeError(f"not an image: {buf[:300]!r}")
            return read_tiff_f32(buf)
        except (OSError, RuntimeError, ValueError) as e:
            last = e
            if attempt < FETCH_RETRIES - 1:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"exportImage failed {FETCH_RETRIES} times: {last}")


def has_values(grid: np.ndarray) -> bool:
    """A rectangle the catalogue claims can still decode entirely sparse."""
    return bool(np.isfinite(grid).any())
