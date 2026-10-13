
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
from report import level_range, plural, size, spaced

HERE = Path(__file__).resolve().parent

SNAPSHOT = HERE / "catalogue.json"

SERVED_STORE = "/site/tufteseid/data/cvat"

def snapshot(refresh=False):
    names = snap["names"]
    if not 1 <= index <= len(names):
        sys.exit(f"no acquisition {index}; the numbers run 1..{len(names)}. "
                 "Try -l")
    return names[index - 1]

def resolve(snap, out, token):
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

        replacing = redo and not set(levels) - set(building)
        if not (force or replacing):
            sys.exit(
                f"  It was built under recipe {digest}, and this run is "
                f"{want}.\n  Adding to it would leave one acquisition made of "
                "two kinds of pixel. Rebuild\n  what it holds with --redo, or "
                "--force if you know the difference does not\n  reach the "
                "tiles."
            )
        print(f"  Recipe {digest} ≠ {want}, "
              + ("and --redo rebuilds every level it holds." if replacing
                 else "forced."))

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

    levels = wanted_levels(name, cell_of(snap, name), args.levels)
    target = build_tiles.store_path(out, name)
    recipe = build_tiles.settings(levels, args.unit_tiles)
    if not args.dry_run:
        guard(target, name, recipe, levels, args.force, args.redo)
    mask = report.mask_for(name)

    if args.dry_run:
        build_tiles.run_levels(
            None, name, mask, levels, args.unit_tiles,
            done=(lambda z: set()) if args.redo
            else (lambda z: build_tiles.marked_units(out, name, z)))
        return

    if args.redo:
        forget(out, name, mask, levels, args.unit_tiles, args.limit)
    store = build_tiles.Store(target, write=True)
    store.stamp(name, recipe)
    try:
        build_tiles.run_levels(store, name, mask, levels, args.unit_tiles,
                               args.jobs, args.limit)
    finally:

        store.stamp(name, recipe)
        store.close()
    delivered(target, name)

def forget(out, name, mask, levels, unit_tiles, limit=None):
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
    p.add_argument("-g", "--get", nargs="?", const="", metavar="ACQ",
                   help="build an acquisition into one .mbtiles file, named by "
                        "its number in -l, by its name, or by the file already "
                        "holding it. Bare, alongside -c, it repairs whatever "
                        "the check found")
    p.add_argument("-c", "--check", nargs="?", const="", metavar="ACQ",
                   help="read an acquisition's tiles back and tally them "
                        "against the footprint; takes the same number, name or "
                        "file as -g")
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
    p.add_argument("--redo", action="store_true",
                   help="fetch and render the units already finished rather "
                        "than skipping them, over the levels this run covers. "
                        "Narrow it with -z")
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
        return

    if args.redo and args.check is not None:
        sys.exit("--redo rebuilds whatever is there, and -c reads it back to "
                 "find what needs\nrebuilding; ask for one or the other.")

    asked = list(dict.fromkeys(t for t in (args.get, args.check) if t))
    named = {resolve(snap, args.out, token) for token in asked}
    if len(named) > 1:
        sys.exit(f"-g and -c name different acquisitions "
                 f"({' and '.join(repr(n) for n in sorted(named))}); there is "
                 "only one to act on.")
    if not named:
        sys.exit("-g and -c want an acquisition: its number in -l, its name, "
                 "or the file already\nholding it. Try -l")
    args.fix = args.get is not None
    name = named.pop()

    if args.check is not None:
        do_check(args, name)
    else:
        do_get(args, snap, name)

if __name__ == "__main__":
    main()
