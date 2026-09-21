"""The cached cVAT ground, from the command line.

    .venv/bin/python vatcache.py -l                 what is worth building, and
                                                    what the store already holds
    .venv/bin/python vatcache.py -l -v              with the figures behind it
    .venv/bin/python vatcache.py -l --all østfold   everything Kartverket flew
    .venv/bin/python vatcache.py -g 3               build acquisition 3
    .venv/bin/python vatcache.py -g 3 -z 15         build only its z15
    .venv/bin/python vatcache.py -c                 audit the whole store
    .venv/bin/python vatcache.py -c 3               audit one acquisition
    .venv/bin/python vatcache.py -c 3 -g            audit it, then repair it

An acquisition is named by its position in the list `-l` prints, which is the
committed queue in `acquisitions.json` followed by anything the store holds that
is not on it. Naming one thing picks the footprint, the mask, the DEM request
and the database together, which is the point: the one mistake this batch could
make silently was pairing a mask with the wrong project, and an index cannot
make it.

How deep the ladder goes needs no asking. It comes off the cell size
hoydedata.no publishes the acquisition on — z16 for the 0.25 m flights, z15 for
the 0.5 m ones — so a queue of mixed densities builds each to what it holds and
no further.

`-z` names levels when part of that ladder is what you want rather than all of
it: `-z 15` for a pilot, `-z 16-14` for a range, `-z 16,12` for two. It is a way
of building less, never a way around the cell — a level finer than the
acquisition's own DTM is refused, because rendering the interpolation between
height values as terrain is the fault the ladder exists to prevent. Under `-c`
it narrows the audit, where any level the store holds is fair to read.

`--out` is the store — the directory docker-compose bind-mounts read-only into
the cvat-tiles sidecar, holding one `<slug>.mbtiles` per acquisition beside the
manifest. Masks are derived on first use and live beside this script as
`coverage-<slug>.npz`.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import acquisitions
import build_tiles
import coverage as coverage_mod

# Where the store is on the server that serves it. README.md and
# docker-compose.yml both name this path; --out is for a copy somewhere else.
DEFAULT_STORE = "/site/tufteseid/data/cvat"

# -g and -c both take an optional index, and "given without one" has to be told
# apart from "not given at all" — argparse spends None on the latter.
BARE = -1


# ---------------------------------------------------------------------------
# The list
# ---------------------------------------------------------------------------


def read_manifest(out):
    path = Path(out) / "manifest.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except ValueError as err:
        print(f"warning: {path} does not parse ({err})", file=sys.stderr)
        return {}


def store_levels(manifest):
    """Acquisition name to the levels the manifest says are built for it.

    Reads the same block `parseStore` in cvatGround.ts reads, plus the shape a
    store held when it carried exactly one acquisition."""
    block = manifest.get("acquisitions")
    if isinstance(block, dict):
        return {
            name: sorted((entry or {}).get("levels", []), reverse=True)
            for name, entry in block.items()
        }
    if "acquisition" in manifest:
        levels = sorted((int(z) for z in manifest.get("levels", {})), reverse=True)
        return {manifest["acquisition"]: levels}
    return {}


def catalogue(out):
    """The numbered list. The build queue in its committed order, then whatever
    else the store holds — an acquisition somebody built off-list still has to
    be reachable by index, or it can be neither checked nor extended."""
    rows = [dict(row, listed=True) for row in acquisitions.build_queue()]
    known = {row["name"] for row in rows}
    for name in sorted(store_levels(read_manifest(out))):
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


def spaced(n):
    """1 106, the way the figures are written in the README and the docs."""
    return f"{n:,}".replace(",", " ")


def plural(n, one, many=None):
    return f"{spaced(n)} {one if n == 1 else (many or one + 's')}"


def size(nbytes):
    """A store runs to hundreds of megabytes per level; a pilot to a handful."""
    return (f"{nbytes / 1e9:.2f} GB" if nbytes >= 1e9
            else f"{nbytes / 1e6:.1f} MB")


def level_range(levels):
    """z16–z12 when the ladder is unbroken, the levels one by one when it is not
    — a gap in the middle is the thing worth seeing. How deep whole *is* depends
    on the acquisition, so this reads the run rather than assuming a base."""
    if not levels:
        return "—"
    if len(levels) == 1:
        return f"z{levels[0]}"
    if len(levels) == max(levels) - min(levels) + 1:
        return f"z{max(levels)}–z{min(levels)}"
    return ", ".join(f"z{z}" for z in sorted(levels, reverse=True))


def parse_levels(text):
    """`-z 14`, `-z 16,14,12`, `-z 16-14`: one level, a list, or an inclusive
    range. A range may be written either way up, because which end is "first"
    depends on whether you are thinking in zoom or in metres.

    Deepest first whatever the order asked in — that is the order a build wants
    and the order the manifest records, so a level set cannot arrive meaning one
    thing and be stored meaning another.

    Bounded by the ladder `build_tiles` defines. A level outside it has nowhere
    to go: the manifest hands the app its `minZoom`/`maxZoom` straight, so a z17
    in the store is a level the reader asks for and no flight in the country can
    answer."""
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
    built = store_levels(read_manifest(out))
    names_cat = names_wms = None
    cells = {}
    if verbose:
        print("asking hoydedata.no and the per-project WMS what they publish…")
        names_cat = acquisitions.catalogue_names()
        names_wms = acquisitions.wms_names()
        cells = acquisitions.native_cells([row["name"] for row in rows])
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
        # The committed cell is what the queue was ordered on; the catalogue's
        # is what the next build will actually ask the ladder for. They should
        # agree, and a reflight that changed the answer is worth seeing.
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
        # Off the units table, so there is no total to divide by: deriving a
        # mask to get one would turn listing the acquisitions into building
        # them.
        counts = {
            z: len(build_tiles.marked_units(out, name, z))
            for z in build_tiles.DEFAULT_LEVELS
        }
        marks = ", ".join(f"z{z} {spaced(n)}" for z, n in counts.items() if n)
        print(f"     units    {marks or '—'}")
        mask = coverage_mod.mask_file(name)
        print(f"     mask     {mask.name if mask.exists() else '— (derived on --get)'}")
        # Both name sets have to carry the acquisition verbatim, and they fail
        # differently: missing from hoydedata is nothing to render, missing from
        # the WMS is tiles the app never asks for.
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
        print(f"     {name}{'  ← ' + level_range(built[name]) if name in built else ''}")
    print("\nTo build one of these, add it to acquisitions.json. Only the name "
          "has to be right;\nthe ladder comes off the catalogue's own cell size, "
          "and a flight published on\n0.5 m or 1 m stops at z15 or z14 whatever "
          "the file says about it.")


# ---------------------------------------------------------------------------
# Building
# ---------------------------------------------------------------------------


def mask_for(project):
    """The acquisition's footprint, derived on first use."""
    path = coverage_mod.load_or_build(project)
    mask = build_tiles.Coverage(path)
    # Masks written before the stamp existed name no acquisition, so nothing
    # can tell whether this one is of the right ground. Deriving it again is
    # minutes, and the alternative is a run that fetches somewhere else.
    if mask.project is None:
        sys.exit(
            f"{path.name} carries no acquisition name, so it cannot be checked "
            f"against {project!r}.\nDelete it and the next run derives one: "
            f"rm {path}"
        )
    return mask


def build_levels(row, asked):
    """Which levels to build for this acquisition.

    The ladder comes off the catalogue's own cell size rather than the committed
    file, because the cell is what makes a level worth having: z16 over a 0.5 m
    flight would render the interpolation between height values as if it were
    ground. The committed `cell_m` is only the figure the queue was ordered on,
    and a reflight can change it under us.

    `-z` is measured against that same cell rather than replacing it. Naming
    levels is for building part of a ladder — one level again, or a pilot before
    the rest — and the one thing it must not become is a way past the rule the
    ladder is. So the cell is read whether or not levels were asked for, and it
    is read before the mask is derived, which is minutes."""
    project = row["name"]
    cell = acquisitions.native_cells([project]).get(project)
    if cell is None:
        sys.exit(
            f"hoydedata.no's catalogue has no row for {project!r}, so there is "
            "no cell size to\npick levels from — and nothing to fetch either. "
            "Check the name against -l --all."
        )
    earned = list(build_tiles.levels_for(cell))
    if not asked:
        print(f"{project}: {cell} m cells → {level_range(earned)}\n")
        return earned

    finer = [z for z in asked if z > earned[0]]
    if finer:
        sys.exit(
            f"{project} is published on {cell} m cells, so its ladder is "
            f"{level_range(earned)}.\n{level_range(finer)} would be finer than "
            "the DTM, which renders the interpolation\nbetween height values as "
            "terrain. Build it on a flight that holds it."
        )
    print(f"{project}: {cell} m cells → {level_range(earned)}, "
          f"building {level_range(asked)}\n")
    return asked


def do_get(out, row, args):
    project = row["name"]
    # Levels first: deriving a footprint takes minutes, and a level this
    # acquisition cannot hold should say so before any of them are spent.
    levels = build_levels(row, args.levels)
    build_tiles.build(
        out,
        project,
        mask_for(project),
        levels=levels,
        unit_tiles=args.unit_tiles,
        jobs=args.jobs,
        limit=args.limit,
        dry_run=args.dry_run,
        force=args.force,
    )


# ---------------------------------------------------------------------------
# Checking, and repairing what the check found
# ---------------------------------------------------------------------------


def ticker(z):
    """A progress line for the scan. A level is tens of thousands of decodes,
    which is long enough that silence reads as a hang."""
    last = [0.0]

    def tick(seen, total):
        now = time.perf_counter()
        if now - last[0] < 0.5 and seen < total:
            return
        last[0] = now
        print(f"\r  z{z} scanning {seen}/{total} units…", end="", flush=True)

    return tick


def check_acquisition(out, project, levels, unit_tiles, verbose):
    """Every named level of one acquisition, printed as it goes."""
    mask = mask_for(project)
    print(f"{project}")
    reports = []
    for z in levels:
        result = build_tiles.check_level(
            out, project, mask, z, unit_tiles, progress=ticker(z)
        )
        reports.append(result)
        state = "ok" if result.ok else "INCOMPLETE"
        print(f"\r  z{z}  {result.done}/{result.units} units, "
              f"{spaced(result.tiles)} tiles, {size(result.bytes)}   {state}"
              + " " * 16)
        if result.todo:
            print(f"        {plural(len(result.todo), 'unit')} never built")
        if result.broken:
            print(f"        {plural(len(result.broken), 'tile does', 'tiles do')} "
                  "not decode")
        if result.stray:
            print(f"        {plural(len(result.stray), 'finished unit')} outside "
                  "the footprint (mask or --unit-tiles changed since)")
        # Some empty units are the footprint clipping a corner. All of them is
        # the fetch having been pinned to ground the acquisition never flew.
        if result.empty and result.empty == result.done:
            print("        every finished unit is empty — the mask and the DEM "
                  "are of different ground")
        elif result.empty:
            print(f"        {plural(result.empty, 'finished unit holds', 'finished units hold')}"
                  " no tile (footprint edge)")
        if verbose:
            for unit in result.todo[:40]:
                print(f"          todo   unit {unit[0]}_{unit[1]}")
            for x, y in result.broken[:40]:
                print(f"          broken z{result.z}/{x}/{y}")
    return reports


def do_check(out, row, args):
    """Audit one acquisition, or the whole store when none is named."""
    manifest = read_manifest(out)
    if row is None and not manifest:
        sys.exit(f"no manifest in {out}; there is no store here to check.")

    built = store_levels(manifest)
    if row is not None:
        projects = [row["name"]]
    else:
        projects = sorted(built)
        print(f"{out}  manifest {manifest.get('digest', '—')}  "
              f"{plural(len(projects), 'acquisition')}\n")
        if not projects:
            sys.exit("the manifest names no acquisition, so there is nothing "
                     "here to check against a footprint.")
    check_names(projects)

    found = {}
    for project in projects:
        # The manifest's own levels, because those are what the store claims to
        # hold: checking an acquisition against every level the tool can build
        # would report a 0.5 m flight as missing the z16 it was never owed.
        levels = args.levels or built.get(project) or list(build_tiles.DEFAULT_LEVELS)
        reports = check_acquisition(
            out, project, levels, args.unit_tiles, args.verbose
        )
        found[project] = reports
        report_orphans(out, project, levels, args.unit_tiles)
        print()

    hurt = {
        project: {r.z: r.repairable for r in reports if r.repairable}
        for project, reports in found.items()
    }
    hurt = {p: levels for p, levels in hurt.items() if levels}
    if not hurt:
        print("nothing missing.")
        return
    total = sum(len(u) for levels in hurt.values() for u in levels.values())
    if not args.fix:
        print(f"{plural(total, 'work unit')} to (re)build. Add --get to fix.")
        return
    # A repair clears the unit before rebuilding it, so a dry run would be all
    # of the destruction and none of the repair.
    if args.dry_run:
        print(f"{plural(total, 'work unit')} to (re)build. Drop --dry-run to fix.")
        return

    print(f"repairing {plural(total, 'work unit')}.\n")
    for project, levels in hurt.items():
        for z, units in levels.items():
            build_tiles.unmark(out, project, z, units, args.unit_tiles)
        build_tiles.build(
            out,
            project,
            mask_for(project),
            levels=sorted(levels, reverse=True),
            unit_tiles=args.unit_tiles,
            jobs=args.jobs,
            # Not forced. A repair run whose recipe has drifted from the store's
            # would fill the holes with pixels the rest of the level is not made
            # of, which is the one thing the digest exists to stop.
            force=args.force,
        )


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


def report_orphans(out, project, levels, unit_tiles):
    """Tiles under this acquisition that no finished unit of it claims.

    An acquisition owns its own database, so this is answerable one at a time
    and the answer is unambiguous — which it was not while the store was one
    namespace and a stray tile might have been the neighbour's."""
    for z in levels:
        on_disk = build_tiles.store_tiles(out, project, z)
        if not on_disk:
            continue
        claimed = build_tiles.tiles_under(
            build_tiles.marked_units(out, project, z), unit_tiles
        )
        orphans = on_disk - claimed
        if orphans:
            sample = ", ".join(f"{x}/{y}" for x, y in sorted(orphans)[:5])
            print(f"  z{z}  {plural(len(orphans), 'tile belongs', 'tiles belong')} "
                  f"to no finished unit ({sample}…)")


# ---------------------------------------------------------------------------


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
    p.add_argument("-g", "--get", nargs="?", type=int, const=BARE, metavar="N",
                   help="build acquisition N. Bare, alongside -c, it repairs "
                        "whatever the check found")
    p.add_argument("-c", "--check", nargs="?", type=int, const=BARE, metavar="N",
                   help="verify the tiles of acquisition N, or of the whole "
                        "store when N is left off")
    p.add_argument("-o", "--out", default=DEFAULT_STORE, metavar="DIR",
                   help=f"the tile store (default {DEFAULT_STORE})")
    p.add_argument("-z", "--levels", metavar="SPEC",
                   help="which zoom levels to work on: one (15), a list "
                        "(16,14,12) or an inclusive range (16-14). Left off, "
                        "--get builds as deep as the acquisition's own DTM cell "
                        "allows and --check reads whatever the manifest says is "
                        "there")
    p.add_argument("--unit-tiles", type=int, default=build_tiles.DEFAULT_UNIT_TILES,
                   help="tiles along one side of a work unit")
    p.add_argument("--jobs", type=int, default=1,
                   help="units in parallel; every one is a fetch, so be kind")
    p.add_argument("--limit", type=int,
                   help="stop after this many unbuilt units, for a pilot; run it "
                        "twice and it does the next batch, not the same one")
    p.add_argument("--dry-run", action="store_true", help="count units and stop")
    p.add_argument("--force", action="store_true",
                   help="build into a store whose manifest disagrees about the "
                        "recipe")
    args = p.parse_args()

    if args.get is None and args.check is None and not (args.list or args.all is not None):
        p.print_help()
        return

    args.levels = parse_levels(args.levels) if args.levels else None
    rows = catalogue(args.out)

    if args.list or args.all is not None:
        do_list(args.out, rows, args.verbose, args.all)
        if args.get is None and args.check is None:
            return
        print()

    # One index between them. -c 3 -g and -c -g 3 are the same request; naming
    # two different ones is not a request at all.
    if args.get not in (None, BARE) and args.check not in (None, BARE) \
            and args.get != args.check:
        sys.exit(f"--get {args.get} and --check {args.check} name different "
                 "acquisitions; there is only one to act on.")
    index = args.get if args.get not in (None, BARE) else args.check
    row = pick(rows, index)
    args.fix = args.get is not None

    if args.check is not None:
        do_check(args.out, row, args)
    elif row is None:
        sys.exit("--get needs the number of an acquisition. Try -l")
    else:
        do_get(args.out, row, args)


if __name__ == "__main__":
    main()
