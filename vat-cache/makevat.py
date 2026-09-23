"""One acquisition, one MBTiles file, from upstream DEM — on any machine.

    .venv/bin/python makevat.py -l                everything hoydedata.no carries
    .venv/bin/python makevat.py -l vestfold       the ones whose name says so
    .venv/bin/python makevat.py -l -v vestfold    with the ladder and the names checked
    .venv/bin/python makevat.py -g 1421           build number 1421
    .venv/bin/python makevat.py -g 1421 -z 15     build only its z15
    .venv/bin/python makevat.py -c 1421           read back what came out
    .venv/bin/python makevat.py -l --refresh      re-ask the catalogue

What comes out is one self-contained `<slug>.mbtiles`. Copying it into the store
a tufteseid install serves is the whole deploy:

    scp vestfold-10pkt-2025.mbtiles server:/site/tufteseid/data/cvat/

No manifest to edit, no import step, nothing to restart. Each database carries
its own acquisition name, levels and recipe in its `metadata` table, and the
cvat-tiles sidecar builds `/cvat/manifest.json` out of the files it finds — so
the file really is the whole of the delivery, and the app offers the new ground
on the next page load.

This is the machine-independent half of `vatcache.py`: no store, no committed
queue, no manifest, no notion of a server. It wants Python, `requirements.txt`,
disk, and a route to hoydedata.no — about 11 s of somebody else's CPU per work
unit, which is why it is worth being able to run it somewhere with more of it.
A build here knows nothing about what the destination already holds, and does
not need to: an acquisition is a file, and files do not overlap.

**An acquisition is named by number, never by name.** The names carry spaces,
æøå and parentheses, which a shell takes apart if you let it; `-l` prints the
catalogue numbered and `-g` takes the number. The numbers come off a local
snapshot (`catalogue.json`, written on first use) and stay put — `--refresh`
re-asks hoydedata.no and puts what is new on the end rather than renumbering
around it, so a number written down today still means the same acquisition next
month.

How deep the ladder goes needs no asking. It comes off the cell size the
catalogue publishes the acquisition on — z16 for the 0.25 m flights, z15 for the
0.5 m ones, z14 for the 1 m ones. `-z` builds part of that ladder (`-z 15`,
`-z 16-14`, `-z 16,12`), never past it: a level finer than the DTM renders the
interpolation between height values as terrain, which is the fault the ladder
exists to prevent.
"""

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

import acquisitions
import build_tiles
import coverage as coverage_mod
import report
from report import level_range, plural, size

HERE = Path(__file__).resolve().parent

# The numbered catalogue as this machine last saw it; a build artefact like the
# masks, not a committed file.
SNAPSHOT = HERE / "catalogue.json"

# Where a tufteseid install keeps its store, for the copy line at the end. This
# script never writes there.
SERVED_STORE = "/site/tufteseid/data/cvat"


def snapshot(refresh=False):
    """The catalogue, numbered by position and pinned to this machine.

    Refreshing appends rather than re-sorting, so a number keeps meaning the same
    acquisition; a withdrawn acquisition keeps its number and stops being
    buildable."""
    have = json.loads(SNAPSHOT.read_text()) if SNAPSHOT.exists() else None
    if have and not refresh:
        return have

    print("asking hoydedata.no what it carries…", file=sys.stderr)
    names = sorted(acquisitions.catalogue_names())
    cells = acquisitions.catalogue_cells(names)

    order = list(have["names"]) if have else []
    added = [n for n in names if n not in set(order)]
    order += added
    withdrawn = sorted(set(order) - set(names))

    fresh = {
        "taken": time.strftime("%Y-%m-%d"),
        "names": order,
        "cells": {n: cells[n] for n in order if n in cells},
        "withdrawn": withdrawn,
    }
    SNAPSHOT.write_text(json.dumps(fresh, indent=1, ensure_ascii=False))
    if have:
        moved = [f"{len(added)} new"] if added else []
        if withdrawn:
            moved.append(f"{len(withdrawn)} no longer published")
        print(f"  {', '.join(moved) or 'nothing changed'}; "
              f"{len(order)} numbered\n", file=sys.stderr)
    return fresh


def pick(snap, index):
    """The acquisition that number means."""
    names = snap["names"]
    if not 1 <= index <= len(names):
        sys.exit(f"no acquisition {index}; the numbers run 1..{len(names)}. "
                 "Try -l")
    return names[index - 1]


def cell_of(snap, name):
    """The finest cell the catalogue publishes this acquisition on, which decides
    the ladder. Read from the snapshot; `--refresh` re-asks."""
    cell = snap["cells"].get(name)
    if cell is None:
        sys.exit(
            f"hoydedata.no's catalogue has no cell size for {name!r}, so there "
            "is no ladder to\nbuild and nothing to fetch either. The snapshot "
            f"is from {snap['taken']}; try -l --refresh."
        )
    return cell


def in_hand(out):
    """Acquisition name to the levels the databases in this directory hold, read
    out of each file's own stamp."""
    held = {}
    for path in sorted(Path(out).glob(f"*{build_tiles.STORE_SUFFIX}")):
        try:
            with build_tiles.Store(path) as store:
                name = store.meta("name")
                held[name or f"?{path.stem}"] = store.levels()
        except sqlite3.DatabaseError as err:
            print(f"warning: {path.name} does not read ({err})",
                  file=sys.stderr)
    return held


def guard(target, name, recipe, force):
    """Refuse to add levels to a database holding another acquisition, or one
    built under a different recipe (which would mix two kinds of pixel)."""
    if not target.exists():
        return
    with build_tiles.Store(target) as store:
        was, digest = store.meta("name"), store.meta("digest")
        levels = store.levels()
    if was and was != name:
        sys.exit(
            f"{target.name} is {was!r}, not {name!r}. Two acquisitions cannot "
            "share a file;\nmove it aside first."
        )
    want = build_tiles.recipe_digest(recipe)
    print(f"{target.name} is already here, holding {level_range(levels)}.")
    if digest is None:
        print("  It carries no recipe, so there is no telling whether it was "
              "built like this one.")
    elif digest != want:
        if not force:
            sys.exit(
                f"  It was built under recipe {digest}, and this run is "
                f"{want}.\n  Adding to it would leave one acquisition made of "
                "two kinds of pixel. Build it\n  again from nothing, or "
                "--force if you know the difference does not reach\n  the "
                "tiles."
            )
        print(f"  Recipe {digest} ≠ {want}, forced.")


def do_list(snap, pattern, out, verbose):
    names = snap["names"]
    rows = [(i, n) for i, n in enumerate(names, 1)
            if not pattern or pattern.casefold() in n.casefold()]
    held = in_hand(out)
    gone = set(snap.get("withdrawn", ()))
    wms = acquisitions.wms_names() if verbose else None

    title = f"matching {pattern!r}" if pattern else "in the catalogue"
    print(f"{len(rows)} of {len(names)} acquisitions {title}, "
          f"as hoydedata.no had it on {snap['taken']}\n")
    if not rows:
        print("Nothing by that name. The catalogue spells them by region, "
              "density and year\n(\"Vestfold 10pkt 2025\"); try a shorter "
              "piece, or -l --refresh if it is new.")
        return

    width = min(max(len(n) for _, n in rows), 46)
    if not verbose:
        print(f"    #  {'acquisition'.ljust(width)}   cell  ladder   here")
    for i, name in rows:
        cell = snap["cells"].get(name)
        ladder = level_range(list(build_tiles.levels_for(cell))) if cell else "—"
        mine = level_range(held[name]) if name in held else ""
        if not verbose:
            print(f" {i:4}  {name.ljust(width)}  "
                  f"{(f'{cell} m' if cell else '—').rjust(6)}  "
                  f"{ladder:8} {mine}".rstrip())
            continue

        print(f" {i:4}  {name}")
        if cell:
            print(f"      grid    {cell} m cells → {ladder}")
        else:
            print("      grid    withdrawn from the catalogue — nothing left "
                  "to fetch")
        # The app joins the manifest onto the per-project WMS's layer prefixes
        # and drops an acquisition the WMS does not publish.
        known = "ok" if name in wms else "MISSING — the app would drop this"
        print(f"      wms     {known}")
        mask = coverage_mod.mask_file(name)
        print(f"      mask    {mask.name if mask.exists() else '— (derived on -g)'}")
        print(f"      here    {mine or '—'}")
        if name in gone:
            print("      note    numbered by an older snapshot; hoydedata.no "
                  "no longer lists it")
        print()

    if not verbose:
        print(f"\n`here` is what {out} already holds. -g <number> builds one.")


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
            sys.exit(f"-z: {piece} is outside the ladder, which runs "
                     f"z{deepest} down to z{coarsest}")
        found.update(range(min(ends), max(ends) + 1))
    if not found:
        sys.exit("-z: no zoom level named")
    return sorted(found, reverse=True)


def wanted_levels(name, cell, asked):
    """Which levels to build. `-z` selects within the ladder the cell earns; it
    cannot reach past it."""
    earned = list(build_tiles.levels_for(cell))
    if not asked:
        print(f"{name}\n{cell} m cells → {level_range(earned)}\n")
        return earned

    finer = [z for z in asked if z > earned[0]]
    if finer:
        sys.exit(
            f"{name} is published on {cell} m cells, so its ladder is "
            f"{level_range(earned)}.\n{level_range(finer)} would be finer than "
            "the DTM, which renders the interpolation\nbetween height values as "
            "terrain. Build it on a flight that holds it."
        )
    print(f"{name}\n{cell} m cells → {level_range(earned)}, "
          f"building {level_range(asked)}\n")
    return asked


def do_get(args, snap, name):
    out = Path(args.out)
    # Levels and the file first: both can refuse the run, and deriving a mask
    # takes minutes.
    levels = wanted_levels(name, cell_of(snap, name), args.levels)
    target = build_tiles.store_path(out, name)
    recipe = build_tiles.settings(levels, args.unit_tiles)
    if not args.dry_run:
        guard(target, name, recipe, args.force)
    mask = report.mask_for(name)

    if args.dry_run:
        build_tiles.run_levels(
            None, name, mask, levels, args.unit_tiles,
            done=lambda z: build_tiles.marked_units(out, name, z))
        return

    store = build_tiles.Store(target, write=True)
    store.stamp(name, recipe)
    try:
        build_tiles.run_levels(store, name, mask, levels, args.unit_tiles,
                               args.jobs, args.limit)
    finally:
        # Again at the end, for the level span: the first stamp predates this
        # run's tiles.
        store.stamp(name, recipe)
        store.close()
    delivered(target, name)


def delivered(target, name):
    """What came out, and the one command that deploys it."""
    with build_tiles.Store(target) as store:
        levels = store.levels()
        tiles = store.db.execute("SELECT count(*) FROM tiles").fetchone()[0]
    print(f"\n{target}  {size(target.stat().st_size)}  "
          f"{plural(tiles, 'tile')}  {level_range(levels)}")
    print(f"\nIt says it is {name!r}, which is what the app joins on. Copy it "
          "into the store\nan install serves and it is deployed — nothing to "
          "restart, offered on the next\npage load:\n")
    print(f"    scp {target} <server>:{SERVED_STORE}/")


def do_check(args, name):
    out = Path(args.out)
    target = build_tiles.store_path(out, name)
    if not target.exists():
        sys.exit(f"{target} is not here; there is nothing built to check. "
                 "-g builds it.")
    with build_tiles.Store(target) as store:
        held = store.levels()
    # What the file holds, not every level the tool can build: a 0.5 m flight is
    # not owed a z16.
    levels = args.levels or held
    if not levels:
        sys.exit(f"{target.name} holds no tiles at all.")

    print(f"{target}  {size(target.stat().st_size)}\n")
    mask = report.mask_for(name)
    reports = report.check(out, name, levels, args.unit_tiles, args.verbose,
                           mask)
    report.orphans(out, name, levels, args.unit_tiles)

    hurt = report.repairable(reports)
    if not hurt:
        print("\nnothing missing.")
        return
    total = sum(len(units) for units in hurt.values())
    if not args.fix:
        print(f"\n{plural(total, 'work unit')} to (re)build. Add -g to fix.")
        return
    # A repair clears the unit before rebuilding it, so a dry run would destroy
    # and not repair.
    if args.dry_run:
        print(f"\n{plural(total, 'work unit')} to (re)build. Drop --dry-run "
              "to fix.")
        return

    print(f"\nrepairing {plural(total, 'work unit')}.\n")
    recipe = build_tiles.settings(sorted(hurt, reverse=True), args.unit_tiles)
    for z, units in hurt.items():
        build_tiles.unmark(out, name, z, units, args.unit_tiles)
    store = build_tiles.Store(target, write=True)
    try:
        build_tiles.run_levels(store, name, mask, sorted(hurt, reverse=True),
                               args.unit_tiles, args.jobs)
    finally:
        store.stamp(name, recipe)
        store.close()


def main():
    p = argparse.ArgumentParser(
        prog="makevat",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("-l", "--list", nargs="?", const="", metavar="PATTERN",
                   help="the catalogue, numbered, optionally filtered by "
                        "substring")
    p.add_argument("--refresh", action="store_true",
                   help="re-ask hoydedata.no what it carries. New acquisitions "
                        "get new numbers; the ones already numbered keep theirs")
    p.add_argument("-v", "--verbose", action="store_true",
                   help="the figures behind the list; for -c, name every unit")
    p.add_argument("-g", "--get", nargs="?", type=int, const=-1, metavar="N",
                   help="build acquisition N into one .mbtiles file. Bare, "
                        "alongside -c, it repairs whatever the check found")
    p.add_argument("-c", "--check", type=int, metavar="N",
                   help="read the tiles of acquisition N back and tally them "
                        "against the footprint")
    p.add_argument("-o", "--out", default=".", metavar="DIR",
                   help="where the file goes (default: here)")
    p.add_argument("-z", "--levels", metavar="SPEC",
                   help="which zoom levels to work on: one (15), a list "
                        "(16,14,12) or an inclusive range (16-14). Left off, "
                        "-g builds as deep as the acquisition's own DTM cell "
                        "allows and -c reads whatever the file holds")
    p.add_argument("--unit-tiles", type=int,
                   default=build_tiles.DEFAULT_UNIT_TILES,
                   help="tiles along one side of a work unit")
    p.add_argument("--jobs", type=int, default=1,
                   help="units in parallel; every one is a fetch, so be kind")
    p.add_argument("--limit", type=int,
                   help="stop after this many unbuilt units, for a pilot; run "
                        "it twice and it does the next batch, not the same one")
    p.add_argument("--dry-run", action="store_true", help="count units and stop")
    p.add_argument("--force", action="store_true",
                   help="add levels to a file built under a different recipe")
    args = p.parse_args()

    if args.get is None and args.check is None and args.list is None \
            and not args.refresh:
        p.print_help()
        return

    args.levels = parse_levels(args.levels) if args.levels else None
    snap = snapshot(args.refresh)

    if args.list is not None:
        do_list(snap, args.list, args.out, args.verbose)
        print()
    if args.get is None and args.check is None:
        return  # -l or --refresh on its own

    # One number between them: -c 3 -g and -g 3 -c 3 are the same request.
    if args.get not in (None, -1) and args.check is not None \
            and args.get != args.check:
        sys.exit(f"-g {args.get} and -c {args.check} name different "
                 "acquisitions; there is only one to act on.")
    args.fix = args.get is not None

    if args.check is not None:
        do_check(args, pick(snap, args.check))
    elif args.get == -1:
        sys.exit("-g needs the number of an acquisition. Try -l")
    else:
        do_get(args, snap, pick(snap, args.get))


if __name__ == "__main__":
    main()
