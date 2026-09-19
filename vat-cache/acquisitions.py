"""Which acquisitions exist, which are worth building, and what names they go by.

Three name sets have to agree before a cached ground reaches a reader, and an
acquisition missing from any one of them fails differently:

- **`acquisitions.json`** — the shortlist, ranked by archaeological lokaliteter
  per km² rather than by area. README.md records how the figures were counted
  and the two traps the raw count walks into. Absent here just means nobody has
  ranked it; `--all` lists the rest.
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
SHORTLIST = HERE / "acquisitions.json"

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


def shortlist():
    """The ranked candidates, in the order the file lists them. That order is
    what `--get <i>` indexes, so it is deliberately a committed file rather than
    anything recomputed per run: an index that moves between two invocations
    would point at a different acquisition each time."""
    return json.loads(SHORTLIST.read_text())["acquisitions"]


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
