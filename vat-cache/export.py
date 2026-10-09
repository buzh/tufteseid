"""Order an acquisition's own DTM out of hoydedata.no and bring the files home.

    .venv/bin/python export.py "NDH Stryn 10pkt 2022" --dry-run
    .venv/bin/python export.py "NDH Stryn 10pkt 2022" -m you@example.com
    .venv/bin/python export.py stryn -m you@example.com --limit 2      a pilot
    .venv/bin/python export.py stryn -m you@example.com                carries on
    .venv/bin/python export.py stryn --status                          where it got to

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

A closed acquisition (`TILGANG` 2) is refused outright: the file services
answer 401 whatever is asked, and only the ImageServer will ever serve it.
Pick what to order with `plan.py`; see what has a raw point cloud instead with
`copc.py`.
"""

import argparse
import json
import shutil
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

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

# Mapsheet the server splits each zip along. Not how much is ordered — that is
# the chunk — only how many files come back inside it.
SHEETS = (0, 1000, 2000, 5000, 10000)

DONE = ("complete", "failed", "abandoned")


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


def squares(project, chunk_m):
    """The chunks the acquisition covers and the ground inside them.

    Filled at an eighth of the chunk so a sliver of coverage still claims its
    square; a chunk the flight never reached is never ordered. Order is west to
    east, north first."""
    fine = chunk_m / 8
    feats = coverage_mod.footprints(project)
    if not feats:
        sys.exit(f"{project!r} has no footprint in the mosaic catalogue, so "
                 "there is nothing to order.")
    mask, bounds, _ = coverage_mod.rasterise(
        feats, fine, origin=coverage_mod.GRID_ORIGIN
    )
    x0, _x1, y0, _y1 = bounds
    ox, oy = coverage_mod.GRID_ORIGIN
    j, i = np.nonzero(mask)
    cj = (j + round((y0 - oy) / fine)) // 8
    ci = (i + round((x0 - ox) / fine)) // 8
    out = []
    for block_j, block_i in sorted(set(zip(cj.tolist(), ci.tolist())),
                                   key=lambda c: (-c[0], c[1])):
        west = ox + block_i * chunk_m
        south = oy + block_j * chunk_m
        out.append({
            "cj": block_j, "ci": block_i,
            "bbox": [west, south, west + chunk_m, south + chunk_m],
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
    print(f"{held['project']}: {plural(len(held['chunks']), 'chunk')} of "
          f"{held['chunk_m'] / 1000:g} km")
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
        "chunk_m": args.chunk_km * 1000,
        "email": args.email,
        "cell": row.get("OPPLOSNING") or 0.25,
    }
    path = state_file(project, args.out)
    held = load_state(path, settings)

    if args.status:
        if not held:
            sys.exit(f"Nothing ordered for {project!r} yet ({path.name} is "
                     "not there).")
        report_chunks(held, args.out)
        return

    if held is None:
        print(f"{project}: working out the chunks…", file=sys.stderr)
        chunks, flown = squares(project, settings["chunk_m"])
        held = dict(settings, chunks=chunks, flown_km2=round(flown, 1))
        del held["email"]

    chunks = held["chunks"]
    flown = held["flown_km2"]
    weight = estimate_mb(settings, flown)
    print(f"{project}  {row.get('AARSTALL')}  {settings['cell']} m grid")
    print(f"  {plural(len(chunks), 'chunk')} of "
          f"{settings['chunk_m'] / 1000:g} km over {spaced(round(flown))} km² "
          f"of flown ground")
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
