"""Which acquisitions exist, which are worth building, and what names they go by.

Three name sets have to agree before a cached ground reaches a reader, and an
acquisition missing from any one of them fails differently:

- **`acquisitions.json`** — the build queue, ordered by point density and then
  by what it joins onto, because the cache exists to be read at the resolution
  the flight actually holds. README.md records the rule. Absent here just means
  nobody has queued it; `--all` lists the rest.
- **hoydedata.no's mosaic catalogue** — `LAS_PROJECT_NAME`, which `fetch_dem`
  pins the DEM request to. Absent here, every fetch comes back empty and a run
  writes a store that looks built and holds nothing.
- **Kartverket's per-project WMS** — the layer-name prefix, which is the
  `LidarProject.id` the app publishes and the key `resolveCvatAcquisitions`
  joins the manifest on. Absent here, the tiles are built, correct, and never
  asked for: the app drops the acquisition with a console warning because
  without the catalogue row it has no footprint to rank the cache by.

The names are compared verbatim. They differ by region, density and year and
carry Norwegian letters and hyphens, so there is no normalisation to be had —
either the string matches or the acquisition is the wrong one.
"""

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

from fetch_dem import QUERY

HERE = Path(__file__).resolve().parent
QUEUE_FILE = HERE / "acquisitions.json"

# Kartverket's per-project DTM WMS, the same document lidarProjects.ts parses —
# reached directly rather than through the app's /wms/geonorge proxy, which only
# exists inside the compose stack. ~8 MB, and it answers in about a second.
CAPS_URL = (
    "https://wms.geonorge.no/skwms1/wms.hoyde-dtm-prosjekt"
    "?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0"
)

# The catalogue answers at most 1000 distinct values per call and says so with
# exceededTransferLimit; there are ~1540 acquisitions.
_PAGE = 1000


def slug(project):
    """A directory name for an acquisition. Readable rather than opaque, so the
    marker tree and the mask files can be read with ls; the acquisition names
    differ by region, density and year, so this cannot collide in practice."""
    return re.sub(r"[^0-9a-zæøå]+", "-", project.lower()).strip("-")


def build_queue():
    """The build queue, in the order the file lists them. That order is what
    `--get <i>` indexes, so it is deliberately a committed file rather than
    anything recomputed per run: an index that moves between two invocations
    would point at a different acquisition each time."""
    return json.loads(QUEUE_FILE.read_text())["acquisitions"]


def native_cells(names, timeout=180):
    """Each acquisition's finest published DTM cell, in metres, off the mosaic
    catalogue's own `LOWPS` — which is what decides how deep the ladder goes.

    The service publishes three values and they track point density: 1 m for
    1–3 pkt, 0.5 m for 2–4 pkt, 0.25 m for 5 pkt and up. Nothing is finer than
    0.25 m anywhere in the country, so the name's `10pkt` buys detail inside
    that grid rather than a smaller one."""
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
    # POST, because the acquisition names are long and asking about a queue's
    # worth of them at once overruns what the service accepts in a URL — it
    # answers 404 rather than 414, so the failure does not name itself.
    data = urllib.parse.urlencode(query).encode()
    with urllib.request.urlopen(QUERY, data=data, timeout=timeout) as response:
        body = json.load(response)
    # The service answers statistics fields in upper case whatever they were
    # asked for in, so read the name back rather than assuming either spelling.
    return {
        a["LAS_PROJECT_NAME"]: a.get("CELL", a.get("cell"))
        for a in (f["attributes"] for f in body.get("features", []))
        if a.get("LAS_PROJECT_NAME")
    }


def catalogue_names(timeout=180):
    """Every distinct LAS_PROJECT_NAME hoydedata.no's mosaic catalogue carries."""
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
            # The catalogue carries rows with no project name; they are not
            # acquisitions anyone can pin a fetch to.
            if name:
                names.add(name)
        if not features or not body.get("exceededTransferLimit"):
            return names
        offset += len(features)


def wms_names(timeout=180):
    """Every project prefix the per-project DTM WMS publishes.

    The same split lidarProjects.ts makes: a layer is named `<project>:<style>`
    and the part before the first colon is the id. The app additionally drops
    `Bilde*` (photogrammetry DTMs advertising lidar styles over blank tiles);
    that filter is not applied here, because the question this answers is
    whether a name exists at all."""
    with urllib.request.urlopen(CAPS_URL, timeout=timeout) as response:
        body = response.read()
    return {
        m.group(1).decode("utf-8")
        for m in re.finditer(rb"<Name>([^<:]+):[^<]*</Name>", body)
    }
