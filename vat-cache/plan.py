"""What to build next: the acquisitions that would add the most new ground.

    .venv/bin/python plan.py --built built.txt         the order, against what is made
    .venv/bin/python plan.py --built built.txt --top 12
    .venv/bin/python plan.py telemark                  only the names that fit
    .venv/bin/python plan.py --built built.txt --copc  + whether raw data exists yet
    .venv/bin/python plan.py --cell any --closed       drop the hard filters
    .venv/bin/python plan.py --json FILE               the table, machine-readable

A candidate here is an acquisition worth the ~16 core-hours a full ladder costs:
published on the **0.25 m** grid, so the z16 base reads real ground rather than
interpolation; **open** to download, since a closed one can never be built off
raw data; **not photogrammetry**, because the app drops a `Bilde*` project
(`lidarProjects.ts`) whatever is in the store; and **published by the
per-project WMS**, which is what the manifest joins onto.

What it ranks by is *new* ground. Coverage overlaps heavily — the same
landscape is reflown every few years — so the tenth acquisition down a list
sorted by area may add almost nothing to the nine above it. Each row's `new` is
what it adds on top of every row printed above it and on top of everything
`--built` says is already made, so the column falls away as the list goes on
and the place it reaches zero is the end of the useful queue.

That is a different rule from the one `acquisitions.json` records, which takes
overlap deliberately — two flights over one landscape are two rows, and reading
them against each other is the point. This tool answers the other question: the
most ground for the fewest core-hours. Use both.

**`--built` is how it learns what is made**, because the store is on the server
and this is not. One acquisition per line — names, slugs or `.mbtiles` stems,
`#` comments ignored — which is what `vatcache.py -l` on the server or a plain
`ls` of the store gives. `-o DIR` reads a store here as well, if there is one.

Footprints come from the mosaic catalogue, one query each, rasterised at 200 m
onto a grid every acquisition shares and cached in `plan-<slug>.npz`. The first
run over the whole country is some minutes; after that it is seconds.
"""

import argparse
import heapq
import json
import re
import sys
import time
from pathlib import Path

import numpy as np

import acquisitions
import coverage as coverage_mod
import report
from acquisitions import slug
from report import plural, spaced

HERE = Path(__file__).resolve().parent

# Snapping every footprint to one national origin is what lets two acquisitions'
# coverage meet by index and never by resampling.
ORIGIN = coverage_mod.GRID_ORIGIN

# Ranking cell. 0.04 km² apiece, and within 0.1 % of the 25 m build mask over a
# 1 100 km² acquisition, for 1/64th of the fill.
CELL = 200.0

# Photogrammetry DTMs advertise a lidar project's styles and serve blank tiles,
# so the app drops them whatever the store holds. Same test as lidarProjects.ts.
PHOTOGRAMMETRY = re.compile(r"^Bilde\b", re.I)


def cover_file(project):
    return HERE / f"plan-{slug(project)}.npz"


def cover_cells(project, cell=CELL, refresh=False):
    """The acquisition's footprint as (row, column) on the shared grid."""
    path = cover_file(project)
    if path.exists() and not refresh:
        with np.load(path, allow_pickle=False) as held:
            if float(held["cell"]) == cell and str(held["project"]) == project:
                return held["gj"], held["gi"]

    feats = coverage_mod.footprints(project)
    if not feats:
        np.savez(path, gj=np.empty(0, np.int32), gi=np.empty(0, np.int32),
                 cell=cell, project=project)
        return np.empty(0, np.int32), np.empty(0, np.int32)

    mask, bounds, _ = coverage_mod.rasterise(feats, cell, origin=ORIGIN)
    x0, _x1, y0, _y1 = bounds
    j, i = np.nonzero(mask)
    gj = (j + round((y0 - ORIGIN[1]) / cell)).astype(np.int32)
    gi = (i + round((x0 - ORIGIN[0]) / cell)).astype(np.int32)
    np.savez(path, gj=gj, gi=gi, cell=cell, project=project)
    return gj, gi


def gather(names, cell, refresh, progress=None):
    """Footprints for a list of acquisitions, fetched and cached as it goes.

    Serial on purpose: every miss is a megabytes-wide query against the same
    catalogue `makevat.py` fetches from."""
    found = {}
    for seen, name in enumerate(names, 1):
        if progress:
            progress(seen, name)
        try:
            found[name] = cover_cells(name, cell, refresh)
        except OSError as err:
            print(f"\rwarning: no footprint for {name!r} ({err})",
                  file=sys.stderr)
    return found


def ticker(total):
    last = [0.0]

    def tick(seen, name):
        now = time.perf_counter()
        if now - last[0] < 0.5 and seen < total:
            return
        last[0] = now
        print(f"\r  footprint {seen}/{total}  {name[:40]:<40}",
              end="", file=sys.stderr, flush=True)

    return tick


def flat(cells, j0, i0, width):
    gj, gi = cells
    return (gj - j0).astype(np.int64) * width + (gi - i0)


def grid(every):
    """The smallest shared grid every footprint fits in."""
    gj = np.concatenate([c[0] for c in every if len(c[0])])
    gi = np.concatenate([c[1] for c in every if len(c[1])])
    j0, i0 = int(gj.min()), int(gi.min())
    height, width = int(gj.max()) - j0 + 1, int(gi.max()) - i0 + 1
    if height * width > 400_000_000:
        sys.exit(f"the selection spans {height * CELL / 1000:.0f} x "
                 f"{width * CELL / 1000:.0f} km, which is more grid than this "
                 "holds.\nNarrow it with a name pattern.")
    return j0, i0, height, width


def greedy(cells, covered, rounds):
    """Each pick is the acquisition adding the most on top of the ones before it.

    Lazy: taking ground only shrinks what is left for everybody else, so a stale
    gain that still leads the heap is still the best pick and the rest are never
    recomputed."""
    heap = [(-len(idx), name, 0) for name, idx in cells.items()]
    heapq.heapify(heap)
    order, step = [], 0
    while heap and len(order) < rounds:
        step += 1
        while True:
            negative, name, computed = heapq.heappop(heap)
            if computed == step:
                gain = -negative
                break
            gain = int(np.count_nonzero(~covered[cells[name]]))
            if not heap or gain >= -heap[0][0]:
                break
            heapq.heappush(heap, (-gain, name, step))
        if gain <= 0:
            break
        covered[cells[name]] = True
        order.append((name, gain))
    return order


def read_built(path, known):
    """One acquisition per line — a name, a slug or a `.mbtiles` stem."""
    by_slug = {slug(n): n for n in known}
    names, missed = [], []
    for line in Path(path).read_text().splitlines():
        token = line.split("#")[0].strip()
        if not token:
            continue
        stem = token[:-8] if token.endswith(".mbtiles") else token
        if stem in known:
            names.append(stem)
        elif slug(stem) in by_slug:
            names.append(by_slug[slug(stem)])
        else:
            missed.append(token)
    if missed:
        print(f"warning: {plural(len(missed), 'line')} in {path} name nothing "
              f"in the catalogue ({', '.join(missed[:3])}…)", file=sys.stderr)
    return names


def candidates(rows, pattern, cell_m, closed, wms):
    out = []
    for row in rows:
        name = row["LAS_PROJECT_NAME"]
        if pattern and pattern.casefold() not in name.casefold():
            continue
        if PHOTOGRAMMETRY.match(name):
            continue
        if cell_m is not None and row.get("OPPLOSNING") != cell_m:
            continue
        if not closed and row.get("TILGANG") != acquisitions.OPEN:
            continue
        # The app joins its manifest onto the per-project WMS's layer prefixes
        # and drops an acquisition the WMS does not publish.
        if name not in wms:
            continue
        out.append(row)
    return out


def main():
    p = argparse.ArgumentParser(
        prog="plan",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("pattern", nargs="?", default="",
                   help="only the acquisitions whose name holds this")
    p.add_argument("--built", metavar="FILE", type=Path,
                   help="one acquisition per line, already made; their ground "
                        "is taken before the ranking starts")
    p.add_argument("-o", "--out", metavar="DIR",
                   help="a store on this host to read as built as well")
    p.add_argument("--top", type=int, default=25, metavar="N",
                   help="how many to rank (default 25); the order depends on "
                        "where it stops only in that it stops")
    p.add_argument("--cell", default="0.25", metavar="M",
                   help="published cell to keep: 0.25 (default), 0.5, 1, or "
                        "`any`")
    p.add_argument("--closed", action="store_true",
                   help="include acquisitions closed to download; buildable "
                        "off the ImageServer, never off raw data")
    p.add_argument("--copc", action="store_true",
                   help="say whether each has a point cloud yet (one request "
                        "per row; see copc.py)")
    p.add_argument("--refresh", action="store_true",
                   help="re-ask the catalogue for every footprint")
    p.add_argument("--json", metavar="FILE", type=Path,
                   help="write the table here as well as printing it")
    args = p.parse_args()

    cell_m = None if args.cell == "any" else float(args.cell)

    print("asking hoydedata.no what it carries…", file=sys.stderr)
    rows = acquisitions.catalogue_projects()
    known = {r["LAS_PROJECT_NAME"] for r in rows}
    wms = acquisitions.wms_names()

    made = []
    if args.built:
        made += read_built(args.built, known)
    if args.out:
        made += [n for n in report.held(args.out) if n in known]
    made = list(dict.fromkeys(made))

    pool = [r for r in candidates(rows, args.pattern, cell_m, args.closed, wms)
            if r["LAS_PROJECT_NAME"] not in made]
    if not pool:
        sys.exit("Nothing left to rank. Loosen --cell, drop the pattern, or "
                 "check --built.")

    names = made + [r["LAS_PROJECT_NAME"] for r in pool]
    print(f"{plural(len(pool), 'candidate')}, {len(made)} already made; "
          f"footprints for {len(names)}…", file=sys.stderr)
    cells = gather(names, CELL, args.refresh, ticker(len(names)))
    print("\r" + " " * 64 + "\r", end="", file=sys.stderr, flush=True)

    j0, i0, height, width = grid(list(cells.values()))
    index = {n: flat(c, j0, i0, width) for n, c in cells.items()}
    covered = np.zeros(height * width, bool)
    for name in made:
        if name in index:
            covered[index[name]] = True
    standing = int(covered.sum())

    pending = {r["LAS_PROJECT_NAME"]: index[r["LAS_PROJECT_NAME"]]
               for r in pool if r["LAS_PROJECT_NAME"] in index}
    order = greedy(pending, covered, args.top)

    clouds = {}
    if args.copc:
        import copc
        by_name = {r["LAS_PROJECT_NAME"]: r for r in rows}
        clouds = {name: copc.ask(by_name[name], False)["state"]
                  for name, _ in order}

    per_cell = CELL * CELL / 1e6
    detail = {r["LAS_PROJECT_NAME"]: r for r in rows}
    table, running = [], standing
    for rank, (name, gain) in enumerate(order, 1):
        row = detail[name]
        running += gain
        table.append({
            "rank": rank,
            "name": name,
            "year": row.get("AARSTALL"),
            "density": row.get("PUNKTTETTHET"),
            "cell": row.get("OPPLOSNING"),
            "area_km2": round(len(index[name]) * per_cell, 1),
            "new_km2": round(gain * per_cell, 1),
            "cumulative_km2": round(running * per_cell, 1),
            "copc": clouds.get(name),
        })

    print(f"{plural(len(pool), 'candidate')} "
          f"{'' if cell_m is None else f'on the {args.cell} m grid '}"
          f"the app would show"
          + (f", {len(made)} already made\ncovering "
             f"{spaced(round(standing * per_cell))} km²" if made else "")
          + ".\n")
    width_name = min(max(len(r["name"]) for r in table), 44)
    print(f"   #  {'acquisition'.ljust(width_name)}  year   pkt      km²"
          f"      new  cum new" + ("  point cloud" if args.copc else ""))
    for r in table:
        density = f"{r['density']:g}" if r["density"] else "—"
        line = (f" {r['rank']:3}  {r['name'][:width_name].ljust(width_name)}  "
                f"{str(r['year'] or '—').rjust(4)}  {density.rjust(4)}  "
                f"{spaced(round(r['area_km2'])).rjust(7)}  "
                f"{spaced(round(r['new_km2'])).rjust(7)}  "
                f"{spaced(round(r['cumulative_km2'])).rjust(7)}")
        if args.copc:
            line += f"  {r['copc']}"
        print(line)

    print(f"\n`new` is on top of every row above it. "
          f"{spaced(round(standing * per_cell))} km² was already made; "
          f"these add\n{spaced(round((running - standing) * per_cell))} km².")
    spent = len(pending) - len(order)
    if spent and len(order) < args.top:
        print(f"The other {plural(spent, 'candidate adds', 'candidates add')} "
              "no ground the rows above do not\nalready hold — a reflight of "
              "the same landscape, which is a second row rather\nthan a wider "
              "map. `acquisitions.json` takes those on purpose; this does not.")

    if args.json:
        args.json.write_text(json.dumps(table, indent=1, ensure_ascii=False))
        print(f"\n{args.json} written.")


if __name__ == "__main__":
    main()
