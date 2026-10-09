"""Which acquisitions exist, which are worth building, and what names they go by.

Names are compared verbatim across acquisitions.json, hoydedata.no's mosaic
catalogue and Kartverket's per-project WMS.
"""

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

from fetch_dem import QUERY

HERE = Path(__file__).resolve().parent
QUEUE_FILE = HERE / "acquisitions.json"

# Reached directly: the app's /wms/geonorge proxy only exists in the compose stack.
CAPS_URL = (
    "https://wms.geonorge.no/skwms1/wms.hoyde-dtm-prosjekt"
    "?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0"
)

# The catalogue answers at most 1000 distinct values per call, flagged with
# exceededTransferLimit; there are ~1540 acquisitions.
_PAGE = 1000


def slug(project):
    """A directory name for an acquisition."""
    return re.sub(r"[^0-9a-zæøå]+", "-", project.lower()).strip("-")


def build_queue():
    """The build queue in file order; `--get <i>` indexes that order."""
    return json.loads(QUEUE_FILE.read_text())["acquisitions"]


def native_cells(names, timeout=180):
    """Each acquisition's finest published DTM cell, in metres, off the mosaic
    catalogue's `LOWPS`. Only 1 m (1–3 pkt), 0.5 m (2–4 pkt) and 0.25 m (5 pkt
    and up) occur; nothing finer exists anywhere in the country."""
    if not names:
        return {}
    quoted = ",".join("'" + n.replace("'", "''") + "'" for n in names)
    query = {
        "where": f"LAS_PROJECT_NAME IN ({quoted})",
        "f": "json",
        "returnGeometry": "false",
        "groupByFieldsForStatistics": "LAS_PROJECT_NAME",
        "outStatistics": json.dumps([{
            "statisticType": "min",
            "onStatisticField": "lowps",
            "outStatisticFieldName": "cell",
        }]),
    }
    # POST: a long name list overruns the URL length the service accepts, and it
    # answers 404 rather than 414.
    data = urllib.parse.urlencode(query).encode()
    with urllib.request.urlopen(QUERY, data=data, timeout=timeout) as response:
        body = json.load(response)
    # The service may upper-case statistics field names whatever they were asked in.
    return {
        a["LAS_PROJECT_NAME"]: a.get("CELL", a.get("cell"))
        for a in (f["attributes"] for f in body.get("features", []))
        if a.get("LAS_PROJECT_NAME")
    }


# Acquisitions per POST; the whole catalogue at once would be a 46 kB WHERE clause.
_CELL_CHUNK = 150


def catalogue_cells(names, timeout=180):
    """`native_cells` for a list too long to ask about at once.

    Statistics queries ignore `resultOffset` and carry no `exceededTransferLimit`,
    so one grouped query over the whole mosaic truncates at 1000 groups silently."""
    cells = {}
    for i in range(0, len(names), _CELL_CHUNK):
        cells.update(native_cells(names[i:i + _CELL_CHUNK], timeout))
    return cells


# `TILGANG` is 1 for an acquisition anybody may download and 2 for one behind a
# login; both are served as pixels, so the ImageServer and the WMS do not
# distinguish them and the file services do.
OPEN = "1"

_CATALOGUE_FIELDS = (
    "LAS_PROJECT_ID",
    "LAS_PROJECT_NAME",
    "AARSTALL",
    "OPPLOSNING",
    "PUNKTTETTHET",
    "TILGANG",
    "KOORDINATSYSTEM",
)


def catalogue_projects(timeout=180):
    """Every acquisition the mosaic catalogue carries, one row each.

    `LAS_PROJECT_ID` is what the LaserInnsyn services take; the name is what
    everything else joins on."""
    rows, offset = [], 0
    while True:
        query = {
            "where": "1=1",
            "f": "json",
            "returnGeometry": "false",
            "outFields": ",".join(_CATALOGUE_FIELDS),
            "returnDistinctValues": "true",
            "orderByFields": "LAS_PROJECT_ID",
            "resultOffset": str(offset),
            "resultRecordCount": str(_PAGE),
        }
        url = QUERY + "?" + urllib.parse.urlencode(query)
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = json.load(response)
        features = body.get("features", [])
        # The catalogue carries rows with no project name.
        rows += [f["attributes"] for f in features
                 if f["attributes"].get("LAS_PROJECT_NAME")]
        if not features or not body.get("exceededTransferLimit"):
            return rows
        offset += len(features)


def catalogue_names(timeout=180):
    """Every distinct LAS_PROJECT_NAME hoydedata.no's mosaic catalogue carries."""
    return {row["LAS_PROJECT_NAME"] for row in catalogue_projects(timeout)}


def wms_names(timeout=180):
    """Every project prefix the per-project DTM WMS publishes.

    Layers are named `<project>:<style>`; the part before the first colon is the id.
    Unlike lidarProjects.ts this does not drop `Bilde*` photogrammetry DTMs."""
    with urllib.request.urlopen(CAPS_URL, timeout=timeout) as response:
        body = response.read()
    return {
        m.group(1).decode("utf-8")
        for m in re.finditer(rb"<Name>([^<:]+):[^<]*</Name>", body)
    }
