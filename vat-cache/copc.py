"""Which acquisitions hoydedata.no serves a point cloud for, today.

    .venv/bin/python copc.py                 the acquisitions that have one
    .venv/bin/python copc.py vestfold        filtered by substring
    .venv/bin/python copc.py -q              only the build queue
    .venv/bin/python copc.py -a              every acquisition asked about
    .venv/bin/python copc.py -v              + read each index: tiles, points, extent
    .venv/bin/python copc.py --json FILE     the same, machine-readable

Kartverket is converting the laser archive to COPC — LAZ with an octree index,
served off plain HTTP with byte ranges, so a reader takes the points under one
work unit without fetching the flight. Each converted acquisition gets a `.vpc`
beside it: a STAC catalogue naming its `.copc.laz` files and the ground each
covers. That is the one source that would let `makevat.py` grid its own DTM
instead of asking `Prosjekt_DTM` for one.

The conversion is running newest-first and is nowhere near done, which is the
only reason this tool exists: there is no published list of what has landed, so
the way to know is to ask about every acquisition and see. A run takes under a
minute and asks nothing twice — there is no snapshot here, because the answer
is the thing that changes.

**A closed acquisition cannot be asked.** `TILGANG` is 2 for a few hundred of
them, and the file services answer 401 whatever they are asked, while the
ImageServer and the WMS serve their pixels to anybody. So a closed acquisition
is one `makevat.py` can build today and could not build off raw data at all,
whatever the conversion reaches — worth knowing before a queue is planned
around point clouds.
"""

import argparse
import concurrent.futures
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import acquisitions
from report import plural, spaced

# The only endpoint that says what a project's point cloud is called. "Secured"
# names the 401 on a closed acquisition, not a login the open ones need.
SECURED = "https://hoydedata.no/LaserServices/REST/SecuredProjectMetadata.ashx"

# A path recorded against a file that is not there yet; the conversion writes
# the row first. Counted apart from the acquisitions with no path at all,
# because it says the one is coming and the other is not.
PENDING = "pending"
LIVE = "live"
NONE = "—"
CLOSED = "closed"
GONE = "gone"


def quoted(url):
    """Acquisition names carry spaces and æøå, and the path is built out of one."""
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit(
        parts._replace(path=urllib.parse.quote(parts.path))
    )


def index_url(project_id, timeout=60):
    """The acquisition's `.vpc`, or None. 401 on a closed one, 404 on an
    acquisition the catalogue lists and LaserInnsyn does not."""
    with urllib.request.urlopen(
        f"{SECURED}?projectId={project_id}", timeout=timeout
    ) as response:
        return json.load(response).get("CopcPath") or None


def reachable(url, timeout=60):
    request = urllib.request.Request(quoted(url), method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=timeout):
            return True
    except urllib.error.HTTPError:
        return False


def index_summary(url, timeout=300):
    """Tiles, points and the ground they cover, out of the STAC the `.vpc` is."""
    with urllib.request.urlopen(quoted(url), timeout=timeout) as response:
        features = json.load(response).get("features", [])
    points = sum(f["properties"].get("pc:count", 0) for f in features)
    # proj:bbox is (xmin, ymin, zmin, xmax, ymax, zmax) in the acquisition's own
    # CRS, which is 25832 for three quarters of the country.
    boxes = [f["properties"]["proj:bbox"] for f in features
             if f["properties"].get("proj:bbox")]
    extent = None
    if boxes:
        extent = (min(b[0] for b in boxes), min(b[1] for b in boxes),
                  max(b[3] for b in boxes), max(b[4] for b in boxes))
    return len(features), points, extent


def ask(row, verbose):
    """One acquisition's state. Never raises: a fault is a state too."""
    found = {
        "name": row["LAS_PROJECT_NAME"],
        "id": row["LAS_PROJECT_ID"],
        "year": row.get("AARSTALL"),
        "cell": row.get("OPPLOSNING"),
        "crs": row.get("KOORDINATSYSTEM"),
        "url": None,
        "state": NONE,
    }
    if row.get("TILGANG") != acquisitions.OPEN:
        found["state"] = CLOSED
        return found
    try:
        url = index_url(found["id"])
    except urllib.error.HTTPError as err:
        found["state"] = CLOSED if err.code == 401 else GONE
        return found
    except OSError as err:
        found["state"] = f"unreachable ({err})"
        return found
    if not url:
        return found
    found["url"] = url
    found["state"] = LIVE if reachable(url) else PENDING
    if verbose and found["state"] == LIVE:
        try:
            tiles, points, extent = index_summary(url)
            found.update(tiles=tiles, points=points, extent=extent)
        except (OSError, ValueError) as err:
            found["note"] = f"index does not read ({err})"
    return found


def ticker(total):
    """A progress line for the survey; every row is a request."""
    last = [0.0]

    def tick(seen):
        now = time.perf_counter()
        if now - last[0] < 0.5 and seen < total:
            return
        last[0] = now
        print(f"\r  asking about {seen}/{total} acquisitions…",
              end="", file=sys.stderr, flush=True)

    return tick


def survey(rows, jobs, verbose):
    tick = ticker(len(rows))
    found, seen = [], 0
    with concurrent.futures.ThreadPoolExecutor(jobs) as pool:
        for one in pool.map(lambda row: ask(row, verbose), rows):
            found.append(one)
            seen += 1
            tick(seen)
    print("\r" + " " * 48 + "\r", end="", file=sys.stderr, flush=True)
    return found


def select(rows, pattern, queue_only):
    if queue_only:
        wanted = {a["name"] for a in acquisitions.build_queue()}
        rows = [r for r in rows if r["LAS_PROJECT_NAME"] in wanted]
    if pattern:
        rows = [r for r in rows
                if pattern.casefold() in r["LAS_PROJECT_NAME"].casefold()]
    return rows


def extent_line(found):
    west, south, east, north = found["extent"]
    return (f"{spaced(round(west))}, {spaced(round(south))} → "
            f"{spaced(round(east))}, {spaced(round(north))} "
            f"in EPSG:{found['crs']}")


def report_survey(found, scope, show_all, verbose):
    shown = [f for f in found if show_all or f["state"] in (LIVE, PENDING)]
    live = [f for f in found if f["state"] == LIVE]
    pending = [f for f in found if f["state"] == PENDING]
    closed = [f for f in found if f["state"] == CLOSED]
    asked = len(found) - len(closed)

    carry = "carries" if len(live) == 1 else "carry"
    print(f"{len(live)} of {plural(asked, 'acquisition')} {scope} {carry} a "
          f"point cloud, as hoydedata.no\nhad it on "
          f"{time.strftime('%Y-%m-%d')}.\n")
    if not shown:
        print("None of them yet. The conversion is running newest-first, so "
              "this is the\nexpected answer for anything flown a few years ago; "
              "ask again in a month.")
    else:
        width = min(max(len(f["name"]) for f in shown), 46)
        if not verbose:
            print(f"  {'acquisition'.ljust(width)}  year    cell  point cloud")
        for one in sorted(shown, key=lambda f: (-(f["year"] or 0), f["name"])):
            cell = f"{one['cell']} m" if one["cell"] else "—"
            year = str(one["year"] or "—")
            head = (f"  {one['name'].ljust(width)}  {year.rjust(4)}  "
                    f"{cell.rjust(6)}  {one['state']}")
            print(head.rstrip())
            if not verbose:
                continue
            if one.get("tiles"):
                print(f"      cloud   {plural(one['tiles'], 'tile')}, "
                      f"{plural(one['points'], 'point')}")
            if one.get("extent"):
                print(f"      extent  {extent_line(one)}")
            if one.get("note"):
                print(f"      note    {one['note']}")
            if one["url"]:
                print(f"      index   {one['url']}")
            print()

    if pending or closed:
        print()
    if pending:
        print(f"{plural(len(pending), 'acquisition has', 'acquisitions have')} "
              "a path recorded and no file behind it yet.")
    if closed:
        print(f"{plural(len(closed), 'acquisition is', 'acquisitions are')} "
              "closed to download and cannot be asked\nwithout a login. The "
              "ImageServer serves a closed acquisition's pixels to\nanybody, "
              "so makevat.py builds it today; no raw data route reaches it.")


def main():
    p = argparse.ArgumentParser(
        prog="copc",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("pattern", nargs="?", default="",
                   help="only the acquisitions whose name holds this")
    p.add_argument("-q", "--queue", action="store_true",
                   help="only the acquisitions in acquisitions.json")
    p.add_argument("-a", "--all", action="store_true",
                   help="print every acquisition asked about, not only the ones "
                        "that have a point cloud")
    p.add_argument("-v", "--verbose", action="store_true",
                   help="read each index: how many tiles and points it names, "
                        "and the ground they cover")
    p.add_argument("--jobs", type=int, default=8,
                   help="acquisitions asked about in parallel; every one is a "
                        "request, so be kind")
    p.add_argument("--json", metavar="FILE", type=Path,
                   help="write the survey here as well as printing it")
    args = p.parse_args()

    print("asking hoydedata.no what it carries…", file=sys.stderr)
    rows = select(acquisitions.catalogue_projects(), args.pattern, args.queue)
    if not rows:
        sys.exit("Nothing by that name. The catalogue spells them by region, "
                 "density and year\n(\"Vestfold 10pkt 2025\"); try a shorter "
                 "piece, or no pattern at all.")

    found = survey(rows, args.jobs, args.verbose)
    scope = "in the build queue" if args.queue else \
        (f"matching {args.pattern!r}" if args.pattern else "in the catalogue")
    report_survey(found, scope, args.all, args.verbose)

    if args.json:
        args.json.write_text(json.dumps(found, indent=1, ensure_ascii=False))
        print(f"\n{args.json} written.")


if __name__ == "__main__":
    main()
