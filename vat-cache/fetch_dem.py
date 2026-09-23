"""Float DEM patches out of hoydedata.no's Prosjekt_DTM ImageServer; quirks are
documented in `docs/terrain-analysis.md`.

The TIFF reader assumes what the endpoint answers: uncompressed, single band,
32-bit float, tiled, never striped. Absent tiles (TileOffsets 0) are no coverage.
"""

import json
import struct
import urllib.parse
import urllib.request

import numpy as np

BASE = "https://hoydedata.no/arcgis/rest/services/Prosjekt_DTM/ImageServer/exportImage"
QUERY = "https://hoydedata.no/arcgis/rest/services/Prosjekt_DTM/ImageServer/query"

DEFAULT_PROJECT = "Vestfold og Telemark 5pkt 2021"

_TYPE_FMT = {1: "B", 3: "H", 4: "I", 11: "f", 12: "d"}
_TYPE_SIZE = {"B": 1, "H": 2, "I": 4, "f": 4, "d": 8}


def read_tiff_f32(buf: bytes) -> np.ndarray:
    """Tiled uncompressed float32 TIFF -> (H, W) float32, absent tiles NaN."""
    if buf[:2] == b"II":
        en = "<"
    elif buf[:2] == b"MM":
        en = ">"
    else:
        raise ValueError(f"not a TIFF: {buf[:200]!r}")

    _magic, ifd = struct.unpack(en + "HI", buf[2:8])
    tags = {}
    (n,) = struct.unpack(en + "H", buf[ifd : ifd + 2])
    for i in range(n):
        p = ifd + 2 + i * 12
        tag, typ, cnt = struct.unpack(en + "HHI", buf[p : p + 8])
        fmt = _TYPE_FMT.get(typ)
        if fmt is None:
            continue
        size = _TYPE_SIZE[fmt] * cnt
        if size <= 4:
            raw = buf[p + 8 : p + 8 + size]
        else:
            (off,) = struct.unpack(en + "I", buf[p + 8 : p + 12])
            raw = buf[off : off + size]
        # A no-coverage answer is a ~1.6 kB stub whose string tags point past the
        # end of the body.
        if len(raw) < size:
            continue
        tags[tag] = struct.unpack(en + fmt * cnt, raw)

    width, height = tags[256][0], tags[257][0]
    if tags.get(259, [1])[0] != 1:
        raise ValueError("compressed TIFF; dem.ts never sees one")
    tile_w, tile_h = tags.get(322, [None])[0], tags.get(323, [None])[0]
    if tile_w is None:
        raise ValueError("striped TIFF; dem.ts never sees one")

    offsets, counts = tags.get(324, ()), tags.get(325, ())
    out = np.full((height, width), np.nan, np.float32)
    across = (width + tile_w - 1) // tile_w
    for k, (off, cnt) in enumerate(zip(offsets, counts)):
        if off == 0 or cnt == 0:
            continue  # absent tile: no coverage here
        tile = np.frombuffer(
            buf[off : off + cnt], dtype=en + "f4", count=tile_w * tile_h
        ).reshape(tile_h, tile_w)
        row, col = (k // across) * tile_h, (k % across) * tile_w
        h = min(tile_h, height - row)
        w = min(tile_w, width - col)
        out[row : row + h, col : col + w] = tile[:h, :w]
    return out


def fetch(cx, cy, side_m, px, project=DEFAULT_PROJECT, timeout=180) -> np.ndarray:
    """A square of DEM centred on (cx, cy) in EPSG:25833, px x px cells."""
    half = side_m / 2
    mosaic = {
        "mosaicMethod": "esriMosaicAttribute",
        "sortField": "lowps",
        "sortValue": 0,
    }
    if project:
        mosaic["where"] = f"LAS_PROJECT_NAME = '{project}'"
    query = {
        "bbox": f"{cx - half},{cy - half},{cx + half},{cy + half}",
        "bboxSR": 25833,
        "imageSR": 25833,
        "size": f"{px},{px}",
        "format": "tiff",
        "pixelType": "F32",
        "interpolation": "RSP_BilinearInterpolation",
        "renderingRule": json.dumps({"rasterFunction": "None"}),
        "mosaicRule": json.dumps(mosaic),
        "f": "image",
    }
    url = BASE + "?" + urllib.parse.urlencode(query)
    with urllib.request.urlopen(url, timeout=timeout) as response:
        buf = response.read()
    if buf[:2] not in (b"II", b"MM"):
        raise RuntimeError(f"not an image: {buf[:300]!r}")
    return read_tiff_f32(buf)


def catalogue(where, out_fields=None, statistics=None, geometry=False, timeout=180):
    """One /query against the mosaic catalogue."""
    query = {"where": where, "f": "json", "returnGeometry": str(geometry).lower()}
    if out_fields:
        query["outFields"] = ",".join(out_fields)
    if statistics:
        query["outStatistics"] = json.dumps(statistics)
    if geometry:
        query["outSR"] = 25833
    url = QUERY + "?" + urllib.parse.urlencode(query)
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.load(response)
