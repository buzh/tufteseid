"""Order an acquisition's own DTM out of hoydedata.no and bring the files home.

    .venv/bin/python export.py "NDH Stryn 10pkt 2022" --dry-run
    .venv/bin/python export.py "NDH Stryn 10pkt 2022" -m you@example.com
    .venv/bin/python export.py stryn -m you@example.com --limit 2      a pilot
    .venv/bin/python export.py stryn -m you@example.com                carries on
    .venv/bin/python export.py stryn --status                          where it got to
    .venv/bin/python export.py stryn --inspect dem/stryn                what came back

`Prosjekt_DTM`'s `exportImage` renders a window per work unit, which is ~90 GB
of float TIFF over a full ladder, fetched again on every `--redo`, off the one
service that falls over overnight. The export queue answers the other way
round: it hands over the acquisition's own 0.25 m DTM as files, once, and the
build reads them off local disk afterwards.

**It is a queue, not a request.** `StartExport` takes a polygon and returns a
job id; the job runs on Kartverket's machines and may take tens of minutes;
`ExportStatus` says when there is a zip to fetch. All three are open — no
login, no key, and the email is only a copy of the delivery note. This script
submits a few at a time, waits, and downloads what lands.

**One job per chunk.** Coverage is cut into `--chunk-km` squares on the same
national grid the footprints snap to, and chunks the acquisition never flew are
not ordered. Size goes as the square of the chunk and the inverse square of the
cell: at 0.25 m a square kilometre is 64 MB of float32, so the 8 km default is
about 4 GB a job before the zip squeezes it. Smaller chunks mean more jobs in
somebody else's queue; bigger ones mean zips that take an hour.

**Resumable.** `export-<slug>.json` holds every chunk, its job id and what
became of it, so a killed run carries on, `--limit` takes the next batch rather
than the same one, and a failed job is re-ordered by `--retry`.

**Read the delivery before building on it.** `--inspect DIR` walks the
unpacked GeoTIFFs and says what grid, CRS, sample type and nodata actually came
back, and which ordered chunks have no file over them. `resolution 0` meaning
0.25 m and `outputWkid` being honoured are assumptions until a delivery says
so; everything downstream rests on both.

A closed acquisition (`TILGANG` 2) is refused outright: the file services
answer 401 whatever is asked, and only the ImageServer will ever serve it.
Pick what to order with `plan.py`; see what has a raw point cloud instead with
`copc.py`.
"""

import argparse
import json
import math
import re
import shutil
import struct
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from xml.etree import ElementTree

import numpy as np

import acquisitions
import coverage as coverage_mod
from acquisitions import slug
from report import plural, size, spaced

HERE = Path(__file__).resolve().parent

START = "https://hoydedata.no/LaserServices/REST/StartExport.ashx"
STATUS = "https://hoydedata.no/LaserServices/REST/ExportStatus.ashx"

# Read off the export panel's own handler, which calls a(product, format,
# isPointCloud) — a(0, 1, true) for the cloud, a(1, 5, false) for DTM.
PRODUCTS = {"pointcloud": (0, 1), "dtm": (1, 5), "dom": (2, 5), "both": (3, 5)}

# `resolution` 0 is the acquisition's own grid, which is the only one worth
# ordering: 1, 10 and 50 are the national model's and come off static files.
RESOLUTIONS = {"dataset": 0, "1": 1, "10": 10, "50": 50}

DONE = ("complete", "failed", "abandoned")

# `clipToPolygon` does not clip: a job comes back as whole mapsheets of the
# grid `Mapsheetsize` names, so a chunk that is not a block of those spills
# over its neighbours and the same ground is fetched twice. Chunks are cut on
# the sheet grid instead, and nothing overlaps.
#
# Measured off a 1:10000 delivery in EPSG:25833, whose files are named
# `<project>-33-10-<col>-<row>-dtm.tif` for west = col * 6400 - 2 700 000 and
# south = row * 4800 + 6 000 000. The finer divisions halve each way; only
# 10000 has been seen.
SHEET_ORIGIN = (-2700000.0, 6000000.0)
SHEETS = {
    10000: (6400.0, 4800.0),
    5000: (3200.0, 2400.0),
    2000: (1280.0, 960.0),
    1000: (640.0, 480.0),
    0: (6400.0, 4800.0),    # "as dataset", which has been the 1:10000 grid
    1: (6400.0, 4800.0),    # "no division", one file, still cut out of sheets
}


def post(url, fields, timeout=300):
    """The services take multipart form fields and nothing else."""
    mark = "----vatcacheexport"
    body = b""
    for key, value in fields.items():
        body += (f"--{mark}\r\nContent-Disposition: form-data; "
                 f'name="{key}"\r\n\r\n{value}\r\n').encode()
    body += f"--{mark}--\r\n".encode()
    request = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={mark}"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        answer = json.load(response)
    # Some of these handlers answer with JSON inside a JSON string.
    return json.loads(answer) if isinstance(answer, str) else answer


def resolve(rows, token):
    """An acquisition by name, by slug, or by enough of either."""
    by_name = {r["LAS_PROJECT_NAME"]: r for r in rows}
    if token in by_name:
        return by_name[token]
    hits = [r for r in rows
            if token.casefold() in r["LAS_PROJECT_NAME"].casefold()
            or slug(token) == slug(r["LAS_PROJECT_NAME"])]
    if len(hits) == 1:
        return hits[0]
    if not hits:
        sys.exit(f"Nothing in the catalogue is called {token!r}. Try plan.py, "
                 "or a shorter piece\nof the name.")
    sys.exit(f"{token!r} fits {len(hits)} acquisitions:\n  "
             + "\n  ".join(sorted(r["LAS_PROJECT_NAME"] for r in hits[:12])))


def sheet_block(chunk_m, sheet):
    """Chunk size as whole mapsheets: (width, height, across, down).

    A chunk that is not a whole number of sheets on a sheet edge buys nothing —
    the delivery rounds out to sheets anyway — so `--chunk-km` is taken as a
    wish and rounded to the nearest block of them."""
    wide, tall = SHEETS[sheet]
    across = max(1, round(chunk_m / wide))
    down = max(1, round(chunk_m / tall))
    return across * wide, down * tall, across, down


def squares(project, chunk_m, sheet):
    """The chunks the acquisition covers and the ground inside them.

    Filled fine enough that a sliver of coverage still claims its square; a
    chunk the flight never reached is never ordered. Order is west to east,
    north first."""
    wide, tall, _, _ = sheet_block(chunk_m, sheet)
    fine = math.gcd(int(wide), int(tall)) / 8
    feats = coverage_mod.footprints(project)
    if not feats:
        sys.exit(f"{project!r} has no footprint in the mosaic catalogue, so "
                 "there is nothing to order.")
    mask, bounds, _ = coverage_mod.rasterise(feats, fine, origin=SHEET_ORIGIN)
    x0, _x1, y0, _y1 = bounds
    ox, oy = SHEET_ORIGIN
    j, i = np.nonzero(mask)
    cj = (j + round((y0 - oy) / fine)) // int(tall / fine)
    ci = (i + round((x0 - ox) / fine)) // int(wide / fine)
    out = []
    for block_j, block_i in sorted(set(zip(cj.tolist(), ci.tolist())),
                                   key=lambda c: (-c[0], c[1])):
        west = ox + block_i * wide
        south = oy + block_j * tall
        out.append({
            "cj": block_j, "ci": block_i,
            "bbox": [west, south, west + wide, south + tall],
            "job": None, "state": None, "url": None, "file": None,
        })
    return out, float(mask.sum()) * fine * fine / 1e6


def order(chunk, settings):
    """One StartExport. Returns the job id."""
    west, south, east, north = chunk["bbox"]
    product, file_format = PRODUCTS[settings["product"]]
    request = {
        "projects": settings["project"],
        "inputWkid": "25833",
        # Counter-clockwise and closed, the way GeoJSON wants a shell.
        "coordInput": {"type": "Polygon", "coordinates": [[
            [west, south], [east, south], [east, north], [west, north],
            [west, south],
        ]]},
        "projectProduct": product,
        "format": file_format,
        "resolution": RESOLUTIONS[settings["resolution"]],
        "outputWkid": settings["wkid"],
        "clipToPolygon": 1,
        "nonOverlappingProjects": 0,
        "nhm": 0,
        "projectMerge": 1 if settings["sheet"] == 1 else 0,
        "Mapsheetsize": 0 if settings["sheet"] == 1 else settings["sheet"],
        "copyEmail": settings["email"],
        "name": f"{settings['project']} {chunk['cj']}_{chunk['ci']}",
        "username": "",
    }
    answer = post(START, {"request": json.dumps(request, ensure_ascii=False)})
    job = answer.get("JobID") or answer.get("jobId") or answer.get("Id")
    if not job:
        raise RuntimeError(f"StartExport refused the chunk: {answer}")
    return int(job)


def status(job):
    return post(STATUS, {"request": json.dumps({"JobID": job})})


def download(url, into, timeout=1800):
    """Straight to disk under a `.part` name, so a half file is never mistaken
    for a whole one."""
    name = Path(urllib.parse.urlsplit(url).path).name or "export.zip"
    target = into / name
    part = target.with_suffix(target.suffix + ".part")
    with urllib.request.urlopen(url, timeout=timeout) as response, \
            part.open("wb") as out:
        shutil.copyfileobj(response, out, 1 << 20)
    part.rename(target)
    return target


# Enough of TIFF to read a header and no pixels. `fetch_dem.read_tiff_f32`
# decodes instead, and refuses anything compressed; a delivery is whatever the
# server felt like writing, so this reads the tags and judges nothing.
_TIFF_TYPE = {1: ("B", 1), 3: ("H", 2), 4: ("I", 4), 11: ("f", 4), 12: ("d", 8)}
_COMPRESSION = {1: "none", 5: "LZW", 7: "JPEG", 8: "deflate", 32773: "packbits",
                32946: "deflate", 34925: "LZMA", 50000: "zstd", 50001: "webp"}
_SAMPLE = {1: "uint", 2: "int", 3: "float"}

# A delivery carries its own paperwork beside the elevation: the flight strips,
# the clip polygon, the project report, and point-density rasters that are
# GeoTIFFs on a metre grid and would otherwise be read as terrain.
ASIDE = re.compile(r"(^|/)metadata(/|$)|punkttetthet", re.I)

# ESRI writes a user-defined CRS rather than an EPSG code: ProjectedCSTypeGeoKey
# is 32767 and the name is left in the citation. The zone is still in
# ProjectionGeoKey as 16000 + zone north, and ETRS89's UTM codes are 25800 +
# zone — which is how a delivery that really is on the app's grid still says
# 32767. Kartverket's own published DTM1 does the same.
_USER_DEFINED = 32767


def crs_of(keys, ascii_params):
    """(EPSG or None, the citation). Reads through a user-defined projection."""
    found, zone, named = None, None, {}
    for n in range(4, len(keys) - 3, 4):
        key, where, count, value = keys[n:n + 4]
        if key == 3072 and where == 0:
            found = value
        elif key == 3074 and where == 0 and 16001 <= value <= 16060:
            zone = value - 16000
        elif where == 34737:
            named[key] = ascii_params[value:value + count].strip("|\0 ")
    # GTCitationGeoKey is the short name; ProjectedCitationGeoKey is an ESRI PE
    # string several hundred characters long.
    citation = named.get(1026) or named.get(3073, "")
    if found and found != _USER_DEFINED:
        return found, citation
    # ETRS89 only; a delivery on anything else is worth seeing spelled out.
    if zone and "ETRS" in " ".join(named.values()).upper():
        return 25800 + zone, citation
    return None, citation


def tiff_header(path):
    """Grid, CRS and sample type out of a GeoTIFF, reading no pixels.

    Seeks rather than reading a prefix: a writer may leave the IFD at the end
    of the file, and a tag's values anywhere at all."""
    with open(path, "rb") as handle:
        def at(offset, length):
            handle.seek(offset)
            return handle.read(length)

        start = at(0, 8)
        if len(start) < 8:
            return {"error": "too short to be a TIFF"}
        if start[:2] == b"II":
            end = "<"
        elif start[:2] == b"MM":
            end = ">"
        else:
            return {"error": "not a TIFF"}
        magic = struct.unpack(end + "H", start[2:4])[0]
        if magic == 43:
            return {"error": "BigTIFF, which nothing here reads"}
        if magic != 42:
            return {"error": f"TIFF magic {magic}, which nothing here reads"}

        (ifd,) = struct.unpack(end + "I", start[4:8])
        entries = at(ifd, 2)
        if len(entries) < 2:
            return {"error": "the directory offset points past the file"}
        (count,) = struct.unpack(end + "H", entries)
        block = at(ifd + 2, count * 12)
        tags = {}
        for n in range(min(count, len(block) // 12)):
            field = block[n * 12:n * 12 + 12]
            tag, kind, many = struct.unpack(end + "HHI", field[:8])
            fmt = _TIFF_TYPE.get(kind)
            if fmt is None and kind != 2:
                continue
            span = many if kind == 2 else fmt[1] * many
            if span <= 4:
                raw = field[8:8 + span]
            else:
                (far,) = struct.unpack(end + "I", field[8:12])
                raw = at(far, span)
            if len(raw) != span:
                continue
            tags[tag] = (raw.decode("latin1") if kind == 2
                         else struct.unpack(end + fmt[0] * many, raw))

    epsg, citation = crs_of(tags.get(34735, ()), tags.get(34737, ""))
    scale = tags.get(33550)
    tie = tags.get(33922)
    nodata = tags.get(42113, "").split("\0")[0].strip() or None

    return {
        "width": tags.get(256, (None,))[0],
        "height": tags.get(257, (None,))[0],
        "cell": (scale[0], scale[1]) if scale else None,
        "origin": (tie[3], tie[4]) if tie and len(tie) >= 6 else None,
        "epsg": epsg,
        "citation": citation,
        "sample": f"{_SAMPLE.get(tags.get(339, (1,))[0], '?')}"
                  f"{tags.get(258, (0,))[0]}",
        "compression": _COMPRESSION.get(tags.get(259, (1,))[0],
                                        str(tags.get(259, (1,))[0])),
        "tiled": bool(tags.get(322)),
        "nodata": nodata,
    }


def extent_of(head):
    """(west, south, east, north) from the tiepoint and the pixel size."""
    if not (head.get("origin") and head.get("cell") and head.get("width")):
        return None
    west, north = head["origin"]
    return (west, north - head["height"] * head["cell"][1],
            west + head["width"] * head["cell"][0], north)


def aux_stats(path):
    """GDAL's sidecar, if the delivery left one. It is where a nodata value and
    the band statistics go when they are not in the TIFF itself."""
    side = Path(str(path) + ".aux.xml")
    if not side.exists():
        return None
    try:
        root = ElementTree.parse(side).getroot()
    except (ElementTree.ParseError, OSError):
        return None
    found = {}
    for band in root.iter("PAMRasterBand"):
        value = band.find("NoDataValue")
        if value is not None and value.text:
            found["nodata"] = value.text.strip()
        for item in band.iter("MDI"):
            key = item.get("key", "")
            if key.startswith("STATISTICS_") and item.text:
                found[key[len("STATISTICS_"):].lower()] = item.text.strip()
    return found or None


def rasters_under(where):
    """Every delivered elevation raster's extent, the paperwork left out."""
    where = Path(where)
    boxes = []
    for path in sorted(where.rglob("*")):
        if path.suffix.lower() not in (".tif", ".tiff"):
            continue
        if ASIDE.search(path.relative_to(where).as_posix()):
            continue
        try:
            box = extent_of(tiff_header(path))
        except (OSError, struct.error):
            continue
        if box:
            boxes.append(box)
    return boxes


def adopt(chunks, where, sheet):
    """Mark the chunks every sheet of which is already unpacked.

    A chunk is a whole block of mapsheets, so this is exact: either all of its
    sheets are on disk or it still has to be ordered. It is what makes a run
    survive a lost job record, and what keeps ground already fetched under an
    older chunk grid from being fetched again."""
    boxes = rasters_under(where)
    if not boxes:
        return 0
    wide, tall = SHEETS[sheet]
    taken = 0
    for chunk in chunks:
        if chunk["state"] in DONE:
            continue
        west, south, east, north = chunk["bbox"]
        middles = [(west + (i + 0.5) * wide, south + (j + 0.5) * tall)
                   for i in range(round((east - west) / wide))
                   for j in range(round((north - south) / tall))]
        if all(any(bw <= x <= be and bs <= y <= bn for bw, bs, be, bn in boxes)
               for x, y in middles):
            chunk.update(state="complete", file=str(where))
            taken += 1
    return taken


def one_of(values, name):
    """A single value if they all agree, else the disagreement spelled out."""
    seen = {}
    for value in values:
        seen[value] = seen.get(value, 0) + 1
    if len(seen) == 1:
        return str(next(iter(seen))), None
    worst = sorted(seen.items(), key=lambda kv: -kv[1])
    return (f"{worst[0][0]} and {len(seen) - 1} other",
            f"{name} differs between files: "
            + ", ".join(f"{k} ({v})" for k, v in worst[:4]))


def inspect(where, held, verbose=False):
    """What the unpacked delivery holds, and whether it is what was ordered."""
    where = Path(where)
    tifs, aside = [], []
    for path in sorted(where.rglob("*")):
        if path.suffix.lower() not in (".tif", ".tiff"):
            continue
        (aside if ASIDE.search(path.relative_to(where).as_posix())
         else tifs).append(path)
    zips = sorted(where.rglob("*.zip"))
    clouds = sorted(p for p in where.rglob("*") if p.suffix.lower() == ".laz")
    if not tifs:
        print(f"No elevation GeoTIFF under {where}."
              + (f" {plural(len(zips), 'zip is', 'zips are')} still packed — "
                 "unpack each\ninto a directory of its own first."
                 if zips else "")
              + (f" {plural(len(aside), 'raster')} are the delivery's own "
                 "metadata, which is not it." if aside else "")
              + (f" {plural(len(clouds), 'LAZ file')}, which is a point cloud "
                 "and not this." if clouds else ""))
        return

    heads, broken = [], []
    for path in tifs:
        try:
            head = tiff_header(path)
        except (OSError, struct.error) as err:
            head = {"error": f"{type(err).__name__}: {err}"}
        (broken if head.get("error") else heads).append((path, head))
    if not heads:
        print(f"{plural(len(broken), 'file')} under {where}, none of them a "
              "readable TIFF.")
        for path, head in broken[:5]:
            print(f"  {path.name}: {head['error']}")
        return

    cells = [h["cell"][0] if h["cell"] else None for _, h in heads]
    grid, grid_note = one_of(cells, "pixel size")
    crs, crs_note = one_of([h["epsg"] for _, h in heads], "CRS")
    samples, sample_note = one_of([h["sample"] for _, h in heads], "sample type")
    nodata, nodata_note = one_of([h["nodata"] for _, h in heads], "nodata")

    west = south = east = north = None
    pixels = 0
    for _, h in heads:
        pixels += (h["width"] or 0) * (h["height"] or 0)
        if not (h["origin"] and h["cell"] and h["width"]):
            continue
        x0, y1 = h["origin"]
        x1 = x0 + h["width"] * h["cell"][0]
        y0 = y1 - h["height"] * h["cell"][1]
        west = x0 if west is None else min(west, x0)
        south = y0 if south is None else min(south, y0)
        east = x1 if east is None else max(east, x1)
        north = y1 if north is None else max(north, y1)

    print(f"{where}: {plural(len(heads), 'GeoTIFF')}"
          + (f", {plural(len(zips), 'zip')} still packed" if zips else ""))
    folders = {}
    for path, _ in heads:
        parent = path.parent.relative_to(where).as_posix() or "."
        folders[parent] = folders.get(parent, 0) + 1
    for parent in sorted(folders, key=lambda d: (-folders[d], d))[:6]:
        print(f"  under       {parent}/  {plural(folders[parent], 'file')}")
    if aside:
        print(f"  set aside   {plural(len(aside), 'raster')} of the delivery's "
              "own metadata")
    told = f"EPSG:{crs}" if crs != "None" else "no EPSG code in the file"
    print(f"  grid        {grid} m, {told}")
    if heads[0][1].get("citation"):
        print(f"  crs says    {heads[0][1]['citation'][:68]}")
    print(f"  samples     {samples}, {heads[0][1]['compression']}, "
          f"{'tiled' if heads[0][1]['tiled'] else 'striped'}, "
          f"nodata {nodata or '— none declared'}")
    if west is not None:
        print(f"  extent      {spaced(round(west))}, {spaced(round(south))} → "
              f"{spaced(round(east))}, {spaced(round(north))}"
              f"  ({(east - west) / 1000:.1f} x {(north - south) / 1000:.1f} km)")
    try:
        ground = pixels * float(grid) ** 2 / 1e6
        print(f"  pixels      {pixels / 1e9:.2f} Gpx over "
              f"{plural(len(heads), 'file')}, {spaced(round(ground))} km²")
    except ValueError:
        pass

    for note in (grid_note, crs_note, sample_note, nodata_note):
        if note:
            print(f"  ! {note}")
    for path, head in broken[:5]:
        print(f"  ! {path.name}: {head['error']}")

    stats = next((s for s in (aux_stats(p) for p, _ in heads) if s), None)
    if stats:
        told = ", ".join(f"{k} {v}" for k, v in sorted(stats.items()))
        print(f"  aux.xml     {told}")
    elif not nodata or nodata == "None":
        print("  ! no nodata declared, and no .aux.xml to say what fills the "
              "ground\n    the flight never reached — read one file and look "
              "before trusting it")

    if verbose or len(heads) <= 12:
        print()
        for path, head in heads:
            box = extent_of(head)
            where_at = (f"{spaced(round(box[0]))}, {spaced(round(box[1]))} → "
                        f"{spaced(round(box[2]))}, {spaced(round(box[3]))}"
                        f"  {(box[2] - box[0]) / 1000:g} x "
                        f"{(box[3] - box[1]) / 1000:g} km" if box else "no extent")
            print(f"  {path.name}")
            print(f"      {head['width']} x {head['height']} px   {where_at}")

    if held:
        boxes = [b for b in (extent_of(h) for _, h in heads) if b]
        # Only a chunk whose own job landed can be missing anything; the rest
        # are simply not ordered yet, which is not a hole.
        done = [c for c in held["chunks"] if c["file"]]
        empty = [c for c in done if not any(
            bw < c["bbox"][2] and be > c["bbox"][0]
            and bs < c["bbox"][3] and bn > c["bbox"][1]
            for bw, bs, be, bn in boxes)]
        print(f"\n  ordered     {plural(len(held['chunks']), 'chunk')}, "
              f"{len(done)} downloaded, "
              f"{len(held['chunks']) - len(done)} still to come")
        if empty:
            print(f"  ! {plural(len(empty), 'downloaded chunk has', 'downloaded chunks have')}"
                  " no raster over its square")
            for chunk in empty[:6]:
                print(f"    {chunk['cj']}_{chunk['ci']} "
                      f"{[round(v) for v in chunk['bbox']]}")
        spill = [c for c in done if any(
            bw < c["bbox"][0] - 1 or be > c["bbox"][2] + 1
            or bs < c["bbox"][1] - 1 or bn > c["bbox"][3] + 1
            for bw, bs, be, bn in boxes)]
        if spill and boxes:
            west = min(b[0] for b in boxes)
            east = max(b[2] for b in boxes)
            south = min(b[1] for b in boxes)
            north = max(b[3] for b in boxes)
            asked = (min(c["bbox"][0] for c in done),
                     min(c["bbox"][1] for c in done),
                     max(c["bbox"][2] for c in done),
                     max(c["bbox"][3] for c in done))
            print("  ! the delivery reaches past what was ordered, by "
                  f"{max(asked[0] - west, east - asked[2]) / 1000:.1f} km "
                  "east-west\n    and "
                  f"{max(asked[1] - south, north - asked[3]) / 1000:.1f} km "
                  "north-south. clipToPolygon did not clip:\n    whole tiles "
                  "of the delivery's own grid came back. Neighbouring\n    "
                  "chunks will overlap, so unpack an acquisition's zips into "
                  "one tree\n    and let the repeated tiles land on each other.")
        if float(grid) != held["cell"] and held["resolution"] == "dataset":
            print(f"  ! ordered the acquisition's own {held['cell']} m grid "
                  f"and got {grid} m")
        if held["wkid"] and str(held["wkid"]) != crs:
            print(f"  ! ordered EPSG:{held['wkid']} and got EPSG:{crs}")


def state_file(project, out):
    return out / f"export-{slug(project)}.json"


def load_state(path, settings):
    if not path.exists():
        return None
    held = json.loads(path.read_text())
    differs = [k for k in ("product", "resolution", "wkid", "sheet", "chunk_m")
               if held.get(k) != settings[k]]
    if differs:
        sys.exit(f"{path.name} was started with a different {', '.join(differs)}"
                 ".\nFinish it, or move it aside and start again.")
    # Records written before the chunk grid moved off the tile origin name
    # squares that no longer exist, and there is nothing to reconcile them to.
    if list(held.get("origin", ())) != list(SHEET_ORIGIN):
        sys.exit(f"{path.name} was cut on a chunk grid that is not the "
                 "delivery's mapsheet grid.\nThe squares in it do not exist "
                 f"any more.\n  rm {path}\nand order again; what is already "
                 "downloaded stays where it is and is still good.")
    return held


def save_state(path, held):
    path.write_text(json.dumps(held, indent=1, ensure_ascii=False))


def estimate_mb(settings, covered_km2):
    cell = settings["cell"] if settings["resolution"] == "dataset" \
        else float(settings["resolution"])
    if settings["product"] == "pointcloud":
        return None
    return covered_km2 * 1e6 / (cell * cell) * 4 / 1e6


def report_chunks(held, out):
    counts = {}
    for chunk in held["chunks"]:
        counts[chunk["state"] or "not ordered"] = \
            counts.get(chunk["state"] or "not ordered", 0) + 1
    wide, tall = held["chunk_m"]
    print(f"{held['project']}: {plural(len(held['chunks']), 'chunk')} of "
          f"{wide / 1000:g} x {tall / 1000:g} km")
    for state in sorted(counts):
        print(f"  {state:14} {counts[state]}")
    files = [out / c["file"] for c in held["chunks"] if c["file"]]
    here = [f for f in files if f.exists()]
    if here:
        print(f"  {'downloaded':14} {plural(len(here), 'file')}, "
              f"{size(sum(f.stat().st_size for f in here))}")


def run(held, path, out, settings, args):
    """Submit, poll and download until there is nothing left outstanding."""
    todo = [c for c in held["chunks"] if c["state"] not in DONE]
    if args.retry:
        for chunk in held["chunks"]:
            if chunk["state"] in ("failed", "abandoned"):
                chunk.update(job=None, state=None, url=None)
        todo = [c for c in held["chunks"] if c["state"] not in DONE]
    fresh = [c for c in todo if c["job"] is None]
    if args.limit is not None:
        fresh = fresh[:args.limit]
    queue = [c for c in todo if c["job"] is not None] + fresh

    while queue:
        outstanding = [c for c in queue if c["job"] is not None
                       and c["state"] not in DONE]
        while len(outstanding) < args.max_jobs:
            waiting = next((c for c in queue if c["job"] is None), None)
            if waiting is None:
                break
            waiting["job"] = order(waiting, settings)
            waiting["state"] = "new"
            save_state(path, held)
            print(f"  ordered {waiting['cj']}_{waiting['ci']} as job "
                  f"{waiting['job']}")
            outstanding.append(waiting)

        for chunk in outstanding:
            answer = status(chunk["job"])
            chunk["state"] = answer.get("Status") or chunk["state"]
            chunk["url"] = answer.get("Url") or chunk["url"]
            if answer.get("Finished") and chunk["url"] and not chunk["file"]:
                print(f"  job {chunk['job']} is {chunk['state']}; fetching…")
                landed = download(chunk["url"], out)
                chunk["file"] = landed.name
                print(f"    {landed.name}  {size(landed.stat().st_size)}")
            elif answer.get("Finished") and not chunk["url"]:
                print(f"  job {chunk['job']} finished as {chunk['state']} with "
                      "nothing to fetch")
        save_state(path, held)

        queue = [c for c in queue if c["state"] not in DONE or
                 (c["url"] and not c["file"])]
        if queue:
            left = plural(len(queue), 'chunk')
            print(f"  {left} outstanding; next look in {args.poll} s",
                  flush=True)
            time.sleep(args.poll)


def main():
    p = argparse.ArgumentParser(
        prog="export",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("acquisition",
                   help="name, slug, or enough of either to be unambiguous")
    p.add_argument("-m", "--email", default="",
                   help="where hoydedata.no copies the delivery note; the "
                        "script polls regardless, so this is a receipt rather "
                        "than the route")
    p.add_argument("-o", "--out", default=".", type=Path, metavar="DIR",
                   help="where the zips and the job record go (default: here)")
    p.add_argument("--product", default="dtm", choices=sorted(PRODUCTS),
                   help="what to order (default: dtm)")
    p.add_argument("--resolution", default="dataset", choices=sorted(RESOLUTIONS),
                   help="`dataset` is the acquisition's own grid (default)")
    p.add_argument("--wkid", type=int, default=25833,
                   help="0 keeps the acquisition's own CRS; 25833 is the app's, "
                        "and is what the ImageServer is asked for today")
    p.add_argument("--sheet", type=int, default=10000, choices=SHEETS,
                   help="mapsheet the zip is split along inside; 1 is one file "
                        "per chunk")
    p.add_argument("--chunk-km", type=float, default=8.0, metavar="KM",
                   help="side of one job's square (default 8)")
    p.add_argument("--max-jobs", type=int, default=2,
                   help="jobs outstanding at once; somebody else runs them, so "
                        "be kind")
    p.add_argument("--poll", type=int, default=120, metavar="S",
                   help="seconds between looks at the queue")
    p.add_argument("--limit", type=int,
                   help="order no more than this many new chunks, for a pilot; "
                        "run it again and it takes the next batch")
    p.add_argument("--retry", action="store_true",
                   help="order the failed and abandoned chunks again")
    p.add_argument("--status", action="store_true",
                   help="say where the record got to and stop")
    p.add_argument("--adopt", metavar="DIR",
                   help="take the chunks already unpacked here as done, "
                        "whoever ordered them")
    p.add_argument("-v", "--verbose", action="store_true",
                   help="for --inspect, name every file rather than the first "
                        "dozen")
    p.add_argument("--inspect", nargs="?", const="", metavar="DIR",
                   help="read the unpacked GeoTIFFs and say what came back; "
                        "defaults to -o")
    p.add_argument("--dry-run", action="store_true",
                   help="work out the chunks and what they weigh, order nothing")
    args = p.parse_args()

    rows = acquisitions.catalogue_projects()
    row = resolve(rows, args.acquisition)
    project = row["LAS_PROJECT_NAME"]
    if row.get("TILGANG") != acquisitions.OPEN:
        sys.exit(f"{project!r} is closed to download — every file service "
                 "answers 401.\nThe ImageServer still serves its pixels, so "
                 "makevat.py builds it the old way.")

    args.out.mkdir(parents=True, exist_ok=True)
    settings = {
        "project": project,
        "product": args.product,
        "resolution": args.resolution,
        "wkid": args.wkid,
        "sheet": args.sheet,
        "chunk_m": list(sheet_block(args.chunk_km * 1000, args.sheet)[:2]),
        "origin": list(SHEET_ORIGIN),
        "email": args.email,
        "cell": row.get("OPPLOSNING") or 0.25,
    }
    path = state_file(project, args.out)
    held = load_state(path, settings)

    if args.inspect is not None:
        inspect(args.inspect or args.out, held, args.verbose)
        return

    if args.status:
        if not held:
            sys.exit(f"Nothing ordered for {project!r} yet ({path.name} is "
                     "not there).")
        report_chunks(held, args.out)
        return

    if held is None:
        print(f"{project}: working out the chunks…", file=sys.stderr)
        chunks, flown = squares(project, args.chunk_km * 1000,
                                settings["sheet"])
        held = dict(settings, chunks=chunks, flown_km2=round(flown, 1))
        del held["email"]

    if args.adopt:
        taken = adopt(held["chunks"], args.adopt, settings["sheet"])
        print(f"{plural(taken, 'chunk')} already unpacked under {args.adopt}",
              file=sys.stderr)

    chunks = held["chunks"]
    flown = held["flown_km2"]
    weight = estimate_mb(settings, flown)
    print(f"{project}  {row.get('AARSTALL')}  {settings['cell']} m grid")
    wide, tall = settings["chunk_m"]
    _, _, across, down = sheet_block(args.chunk_km * 1000, settings["sheet"])
    print(f"  {plural(len(chunks), 'chunk')} of {wide / 1000:g} x "
          f"{tall / 1000:g} km ({across} x {down} mapsheets) over "
          f"{spaced(round(flown))} km² of flown ground")
    if weight:
        print(f"  about {size(weight * 1e6)} of float32 before the zip, "
              f"{size(weight * 1e6 / len(chunks))} a job on average")
    left = [c for c in chunks if c["state"] not in DONE]
    print(f"  {plural(len(left), 'chunk')} still to order or finish")

    if args.dry_run:
        print("\n--dry-run: nothing ordered. Drop it to start, and give "
              "--limit a small\nnumber the first time.")
        return
    if not args.email:
        sys.exit("\n-m/--email is wanted before anything is ordered: it is "
                 "what hoydedata.no\nputs on the job. --dry-run needs none.")

    save_state(path, held)
    run(held, path, args.out, settings, args)
    report_chunks(held, args.out)


if __name__ == "__main__":
    main()
