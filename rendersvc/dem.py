
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
    return f"LAS_PROJECT_NAME = '{project}'"

def _mosaic_rule(project):
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
    `urlopen` hands the socket's `TimeoutError` back inside a `URLError`."""
    return isinstance(e, TimeoutError) or isinstance(
        getattr(e, "reason", None), TimeoutError
    )

def fetch_grid(model, bbox25833, width, height, log=None, project=None):