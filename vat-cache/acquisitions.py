
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

from fetch_dem import QUERY

HERE = Path(__file__).resolve().parent
QUEUE_FILE = HERE / "acquisitions.json"

CAPS_URL = (
    "https://wms.geonorge.no/skwms1/wms.hoyde-dtm-prosjekt"
    "?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0"
)

_PAGE = 1000

def slug(project):
    return re.sub(r"[^0-9a-zæøå]+", "-", project.lower()).strip("-")

def build_queue():
    return json.loads(QUEUE_FILE.read_text())["acquisitions"]

def native_cells(names, timeout=180):

    Statistics queries ignore `resultOffset` and carry no `exceededTransferLimit`,
    so one grouped query over the whole mosaic truncates at 1000 groups silently."""
    cells = {}
    for i in range(0, len(names), _CELL_CHUNK):
        cells.update(native_cells(names[i:i + _CELL_CHUNK], timeout))
    return cells

def catalogue_names(timeout=180):
    names, offset = set(), 0
    while True:
        query = {
            "where": "1=1",
            "f": "json",
            "returnGeometry": "false",
            "outFields": "LAS_PROJECT_NAME",
            "returnDistinctValues": "true",
            "orderByFields": "LAS_PROJECT_NAME",
            "resultOffset": str(offset),
            "resultRecordCount": str(_PAGE),
        }
        url = QUERY + "?" + urllib.parse.urlencode(query)
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = json.load(response)
        features = body.get("features", [])
        for f in features:
            name = f["attributes"].get("LAS_PROJECT_NAME")

            if name:
                names.add(name)
        if not features or not body.get("exceededTransferLimit"):
            return names
        offset += len(features)

def wms_names(timeout=180):