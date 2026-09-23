"""What the tile store holds, and whether it is sound.

    .venv/bin/python vatcache.py -l          the queue, and what the store holds
    .venv/bin/python vatcache.py -l -v       with the figures behind it
    .venv/bin/python vatcache.py -l --all østfold   everything Kartverket flew
    .venv/bin/python vatcache.py -c          audit the whole store
    .venv/bin/python vatcache.py -c 3        audit one acquisition
    .venv/bin/python vatcache.py -c 3 -v     naming every unit it faults

Building is `makevat.py`'s. It renders one self-contained `<slug>.mbtiles` from
upstream DEM, numbered off hoydedata.no's whole catalogue rather than off the
queue here, and it does not have to run on this machine: point it at this store
with `-o` and it builds in place, or leave it somewhere with more CPU and copy
the file in afterwards. It repairs too — `makevat.py -c <n> -g` — so a fault
this tool reports has one place to be fixed.

What is left here is the store's own side of that. Which acquisitions
`acquisitions.json` says are worth having and in what order; which ones the
databases in the store actually hold and at which levels; and whether the tiles
in them read back against the footprint they claim to cover.

**There is no manifest.** The store is the databases and nothing else: each
carries its own acquisition name and levels in its `metadata` table, and
`cvat-tiles/server.mjs` builds `/cvat/manifest.json` out of the files it finds
whenever it is asked. So an acquisition arrives by being copied in and departs
by being deleted, and this tool learns of either the same way the app does.

`-c` reads whatever levels a database says it holds, since that is what it
claims — auditing a 0.5 m flight against every level the tool can build would
report it as missing the z16 it was never owed. `-z` narrows that: one level
(`-z 15`), a list (`-z 16,14,12`) or an inclusive range (`-z 16-14`).

`--out` is the store — the directory docker-compose bind-mounts read-only into
the cvat-tiles sidecar. Masks are derived on first use and live beside this
script as `coverage-<slug>.npz`.
"""

import argparse
import sys

import acquisitions
import build_tiles
import coverage as coverage_mod
import report
from report import level_range, plural, spaced

# Where the store is on the server that serves it; also named by README.md and
# docker-compose.yml.
DEFAULT_STORE = "/site/tufteseid/data/cvat"

# -c's sentinel for "given without an index"; argparse spends None on "not given".
BARE = -1


def catalogue(out):
    """The numbered list: the build queue in its committed order, then whatever
    else the store holds."""
    rows = [dict(row, listed=True) for row in acquisitions.build_queue()]
    known = {row["name"] for row in rows}
    for name in sorted(report.held(out)):
        if name not in known:
            rows.append({"name": name, "listed": False})
    for i, row in enumerate(rows, 1):
        row["index"] = i
    return rows


def pick(rows, index):
    if index is None or index == BARE:
        return None
    if not 1 <= index <= len(rows):
        sys.exit(f"no acquisition {index}; the list runs 1..{len(rows)}. Try -l")
    return rows[index - 1]


def parse_levels(text):
    """`-z 14`, `-z 16,14,12`, `-z 16-14`: one level, a list, or an inclusive
    range either way up. Returns them deepest first, bounded by the ladder
    `build_tiles` defines."""
    deepest, coarsest = build_tiles.DEFAULT_LEVELS[0], build_tiles.COARSEST_LEVEL
    found = set()
    for piece in (p.strip() for p in text.split(",")):
        if not piece:
            continue
        low, dash, high = piece.partition("-")
        try:
            ends = [int(low), int(high)] if dash else [int(low)]
        except ValueError:
            sys.exit(f"-z: {piece!r} is not a zoom level, or a range of them "
                     "written as 16-14")
        if not all(coarsest <= z <= deepest for z in ends):
            sys.exit(f"-z: {piece} is outside the store's ladder, which runs "
                     f"z{deepest} down to z{coarsest}")
        found.update(range(min(ends), max(ends) + 1))
    if not found:
        sys.exit("-z: no zoom level named")
    return sorted(found, reverse=True)


def do_list(out, rows, verbose, pattern):
    built = report.held(out)
    names_cat = names_wms = None
    cells = {}
    if verbose:
        print("asking hoydedata.no and the per-project WMS what they publish…")
        names_cat = acquisitions.catalogue_names()
        names_wms = acquisitions.wms_names()
        cells = acquisitions.catalogue_cells([row["name"] for row in rows])
        print()

    width = max(len(row["name"]) for row in rows)
    if not verbose:
        print(f"  #  {'acquisition'.ljust(width)}  pkt  in store")
    for row in rows:
        name = row["name"]
        levels = built.get(name, [])
        if not verbose:
            pkt = f"{row['pkt']:3}" if row.get("pkt") else "  —"
            print(f" {row['index']:2}  {name.ljust(width)}  {pkt}  "
                  f"{level_range(levels)}")
            continue

        print(f" {row['index']:2}  {name}")
        # The committed cell ordered the queue; the catalogue's is what a build
        # asks the ladder for. Drift between them is worth seeing.
        cell = cells.get(name)
        listed_cell = row.get("cell_m")
        drift = "" if cell is None or listed_cell in (None, cell) else \
            f"  (acquisitions.json says {listed_cell} m)"
        density = f"{row['pkt']} pkt · " if row.get("pkt") else ""
        if cell:
            print(f"     grid     {density}{cell} m cells → "
                  f"{level_range(list(build_tiles.levels_for(cell)))}{drift}")
        else:
            print(f"     grid     {density}cell unknown — hoydedata.no has no "
                  "row for this name")
        if row.get("where"):
            print(f"     where    {row['where']}")
        if not row.get("listed"):
            print("     where    not in acquisitions.json; found in the store")
        print(f"     store    {level_range(levels)}")
        # Off the units table, so there is no total to divide by: getting one
        # would mean deriving a mask per acquisition.
        counts = {
            z: len(build_tiles.marked_units(out, name, z))
            for z in build_tiles.DEFAULT_LEVELS
        }
        marks = ", ".join(f"z{z} {spaced(n)}" for z, n in counts.items() if n)
        print(f"     units    {marks or '—'}")
        mask = coverage_mod.mask_file(name)
        print(f"     mask     "
              f"{mask.name if mask.exists() else '— (derived on a build)'}")
        # Both name sets must carry the acquisition verbatim: missing from
        # hoydedata is nothing to render, missing from the WMS is tiles the app
        # never asks for.
        print(f"     names    hoydedata {'ok' if name in names_cat else 'MISSING'}"
              f"  ·  wms {'ok' if name in names_wms else 'MISSING'}")
        if row.get("note"):
            print(f"     note     {row['note']}")
        print()

    if pattern is None:
        return
    every = sorted(acquisitions.catalogue_names())
    hits = [n for n in every if pattern.casefold() in n.casefold()]
    title = f"matching {pattern!r}" if pattern else "in the catalogue"
    print(f"\n{len(hits)} of {len(every)} acquisitions {title}:")
    for name in hits:
        print(f"     {name}"
              f"{'  ← ' + level_range(built[name]) if name in built else ''}")
    print("\nTo build one of these: makevat.py -l names the same catalogue with "
          "its own numbers,\nand makevat.py -g <n> renders it. Adding it to "
          "acquisitions.json only puts it on\nthe queue this list shows.")


def do_check(out, row, args):
    """Audit one acquisition, or the whole store when none is named."""
    built = report.held(out)
    if row is not None:
        projects = [row["name"]]
    else:
        if not built:
            sys.exit(f"no databases in {out}; there is no store here to check.")
        projects = sorted(built)
        print(f"{out}  {plural(len(projects), 'acquisition')}\n")
    check_names(projects)

    faults = {}
    for project in projects:
        # What the database says it holds, not every level the tool can build: a
        # 0.5 m flight is not owed a z16.
        levels = args.levels or built.get(project) or list(build_tiles.DEFAULT_LEVELS)
        reports = report.check(out, project, levels, args.unit_tiles,
                               args.verbose)
        faults[project] = report.repairable(reports)
        report.orphans(out, project, levels, args.unit_tiles)
        print()

    hurt = {p: levels for p, levels in faults.items() if levels}
    if not hurt:
        print("nothing missing.")
        return
    total = sum(len(u) for levels in hurt.values() for u in levels.values())
    print(f"{plural(total, 'work unit')} to (re)build. makevat.py repairs "
          "in place:\n")
    # Named, not numbered: makevat.py numbers the whole catalogue and this list
    # is the queue, so an index from one means something else in the other.
    for project in hurt:
        print(f"    makevat.py -l {project!r}")
    print(f"\nthen, with the number that prints: makevat.py -o {out} -c <n> -g")


def check_names(projects):
    """Whether the store's acquisitions are still names the app can join on."""
    cat, wms = acquisitions.catalogue_names(), acquisitions.wms_names()
    for project in projects:
        if project not in cat:
            print(f"  {project}: not in hoydedata.no's catalogue — nothing here "
                  "can be rebuilt or extended")
        if project not in wms:
            print(f"  {project}: not a layer prefix in the per-project WMS — the "
                  "app drops it and never asks for its tiles")
    if all(p in cat and p in wms for p in projects):
        print("  every acquisition is published by both the catalogue and the WMS")
    print()


def main():
    p = argparse.ArgumentParser(
        prog="vatcache",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("-l", "--list", action="store_true",
                   help="the acquisitions, numbered, and what the store holds")
    p.add_argument("--all", nargs="?", const="", metavar="PATTERN",
                   help="with -l, also every acquisition hoydedata.no carries, "
                        "optionally filtered by substring")
    p.add_argument("-v", "--verbose", action="store_true",
                   help="the figures behind the list; for -c, name every unit")
    p.add_argument("-c", "--check", nargs="?", type=int, const=BARE, metavar="N",
                   help="verify the tiles of acquisition N, or of the whole "
                        "store when N is left off")
    p.add_argument("-o", "--out", default=DEFAULT_STORE, metavar="DIR",
                   help=f"the tile store (default {DEFAULT_STORE})")
    p.add_argument("-z", "--levels", metavar="SPEC",
                   help="which zoom levels to check: one (15), a list "
                        "(16,14,12) or an inclusive range (16-14). Left off, "
                        "each acquisition is read at the levels its own "
                        "database says it holds")
    p.add_argument("--unit-tiles", type=int, default=build_tiles.DEFAULT_UNIT_TILES,
                   help="tiles along one side of a work unit")
    args = p.parse_args()

    if args.check is None and not (args.list or args.all is not None):
        p.print_help()
        return

    args.levels = parse_levels(args.levels) if args.levels else None
    rows = catalogue(args.out)

    if args.list or args.all is not None:
        do_list(args.out, rows, args.verbose, args.all)
        if args.check is None:
            return
        print()

    do_check(args.out, pick(rows, args.check), args)


if __name__ == "__main__":
    main()
