"""Divide a store built under the shared tile namespace, one directory per
acquisition.

Stores written before `build_tiles.py` learned about overlap put every
acquisition's tiles in one `<z>/<x>/<y>` tree. The pixels are right; only their
location is wrong, and rebuilding them would be tens of core-hours to recompute
bytes that are already on disk. This moves them instead.

A tile carries no provenance, so what says who wrote it is the acquisitions'
footprints: a tile is the one whose mask reaches it. That is exact wherever the
footprints are disjoint, which over a curated old store is almost everywhere.
Where two masks reach one tile it genuinely could be either — whichever ran last
won, and nothing on disk records which. Those tiles are deleted and their work
units handed back, so the next `--get` rebuilds them under each owner. It is a
handful of units at the edges.

    .venv/bin/python migrate_store.py /site/tufteseid/data/cvat        report
    .venv/bin/python migrate_store.py /site/tufteseid/data/cvat --apply

Deletable once no store in the old layout remains.
"""

import argparse
import json
import sys
from pathlib import Path

import build_tiles
import coverage as coverage_mod
from acquisitions import slug


def legacy_levels(manifest):
    """Acquisition name to its levels, for a manifest that predates `path`.

    Both old shapes: the `acquisitions` block, and the single-acquisition
    manifest from before there was one."""
    block = manifest.get("acquisitions")
    if isinstance(block, dict):
        return {
            name: sorted((entry or {}).get("levels", []), reverse=True)
            for name, entry in block.items()
        }
    if "acquisition" in manifest:
        return {manifest["acquisition"]:
                sorted((int(z) for z in manifest.get("levels", {})), reverse=True)}
    return {}


def shared_tiles(out, z):
    """Every tile still in the shared tree at this level."""
    found = []
    level = Path(out) / str(z)
    if not level.is_dir():
        return found
    for column in sorted(level.iterdir()):
        if not column.is_dir():
            continue
        try:
            x = int(column.name)
        except ValueError:
            continue
        for tile in sorted(column.glob("*.webp")):
            try:
                found.append((x, int(tile.stem), tile))
            except ValueError:
                continue
    return found


def claimants(masks, levels, z, x, y):
    """Which acquisitions' footprints reach this tile at this level. A tile is
    one tile of a one-tile unit, so the unit geometry answers it unchanged."""
    box = build_tiles.unit_bbox(z, x, y, 1)
    return [name for name, mask in masks.items()
            if z in levels[name] and mask.reaches(*box)]


def prune(directory):
    """Drop the emptied column and level directories, deepest first."""
    for path in sorted(Path(directory).rglob("*"), reverse=True):
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()
    if directory.is_dir() and not any(directory.iterdir()):
        directory.rmdir()


def main():
    p = argparse.ArgumentParser(
        prog="migrate_store",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("store", help="the tile store to divide")
    p.add_argument("--apply", action="store_true",
                   help="move the tiles; without it, only report")
    p.add_argument("--unit-tiles", type=int, default=build_tiles.DEFAULT_UNIT_TILES,
                   help="tiles along one side of a work unit, as it was built")
    args = p.parse_args()

    out = Path(args.store)
    manifest_path = out / "manifest.json"
    if not manifest_path.exists():
        sys.exit(f"no manifest in {out}; there is no store here to divide.")
    manifest = json.loads(manifest_path.read_text())

    levels = legacy_levels(manifest)
    if not levels:
        sys.exit("the manifest names no acquisition, so nothing on disk can be "
                 "attributed to one.")
    block = manifest.get("acquisitions") or {}
    if all(isinstance(e, dict) and e.get("path") for e in block.values()):
        print("every acquisition already has a path; this store is divided.")
        return

    # Before anything moves. `open_manifest` refuses a store whose recipe has
    # drifted, and it is the last step here — so a mismatch found then would
    # leave the tiles divided and the manifest still pathless, which is the one
    # state the app cannot read at all.
    if not build_tiles.manifest_agrees(manifest, args.unit_tiles):
        sys.exit(
            f"{manifest_path} (digest {manifest.get('digest')}) was written "
            "under a different recipe\nthan this code computes. Dividing it "
            "would produce a store whose manifest cannot\nbe rewritten. Check "
            "out the commit it was built from, or settle the recipe first."
        )

    print(f"{out}  {len(levels)} acquisitions\n")
    masks = {}
    for name in levels:
        # Derives the mask if it is not beside the script. Minutes and one
        # catalogue query per acquisition, against the hours the tiles took.
        mask = build_tiles.Coverage(coverage_mod.load_or_build(name))
        if mask.project not in (None, name):
            sys.exit(f"coverage-{slug(name)}.npz is the footprint of "
                     f"{mask.project!r}, not {name!r}. Delete it and re-run.")
        masks[name] = mask
        print(f"  {name}  →  {slug(name)}/  z{max(levels[name])}–"
              f"z{min(levels[name])}")
    print()

    every_z = sorted({z for zs in levels.values() for z in zs}, reverse=True)
    moved = {name: 0 for name in levels}
    contested, orphans, parts = {}, 0, 0

    for z in every_z:
        tiles = shared_tiles(out, z)
        if not tiles:
            continue
        here = {name: 0 for name in levels}
        for x, y, path in tiles:
            owners = claimants(masks, levels, z, x, y)
            if len(owners) == 1:
                here[owners[0]] += 1
                if args.apply:
                    dest = build_tiles.tile_path(
                        out, owners[0], z, x, y, 1, 0, 0)
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    path.replace(dest)
            elif owners:
                unit = (x // args.unit_tiles, y // args.unit_tiles)
                for name in owners:
                    contested.setdefault((name, z), set()).add(unit)
                if args.apply:
                    path.unlink()
            else:
                orphans += 1
        for name, n in here.items():
            moved[name] += n
        said = ", ".join(f"{slug(n)} {c}" for n, c in here.items() if c)
        print(f"  z{z}  {len(tiles)} tiles  {said or '—'}")
        # Half-writes belong to no acquisition and to no run that finished.
        for part in sorted((out / str(z)).rglob("*.part")):
            parts += 1
            if args.apply:
                part.unlink()

    print()
    for name, n in moved.items():
        print(f"  {n:7} tiles  {name}")
    if orphans:
        print(f"  {orphans:7} tiles reach no acquisition's footprint — left in "
              "place, nothing claims them")
    if parts:
        print(f"  {parts:7} half-written .part files")
    if contested:
        units = sum(len(u) for u in contested.values())
        print(f"\n  {units} work-unit claims cover tiles two footprints both "
              "reach. Those tiles\n  cannot be attributed, so they go and the "
              "units are handed back:")
        for (name, z), us in sorted(contested.items()):
            print(f"    z{z}  {len(us)} units  {name}")

    if not args.apply:
        print("\nNothing moved. Re-run with --apply.")
        return

    for (name, z), us in contested.items():
        build_tiles.unmark(out, name, z, sorted(us), args.unit_tiles)
    for z in every_z:
        prune(out / str(z))

    # Rewriting per acquisition, because `open_manifest` is the one place that
    # knows the slug rule and the level merge. It backfills a path onto every
    # entry, including the ones this run did not name.
    for name, zs in levels.items():
        build_tiles.open_manifest(out, name, zs, args.unit_tiles, force=False)
    print(f"\n{manifest_path} rewritten with a path per acquisition.")
    if contested:
        print("Run the affected acquisitions again to refill the handed-back "
              "units.")


if __name__ == "__main__":
    main()
