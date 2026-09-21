"""Pack a store of loose tile files into one MBTiles database per acquisition.

A store written before `build_tiles.py` learned about SQLite is a tree of
`<slug>/<z>/<x>/<y>.webp` — some 83 000 files per acquisition, nine of them, and
a backup that spends its night calling stat(). The pixels are right; only their
container is wrong, and rebuilding them would be tens of core-hours to recompute
bytes that are already on disk. This moves them instead.

    .venv/bin/python pack_store.py /site/tufteseid/data/cvat           report
    .venv/bin/python pack_store.py /site/tufteseid/data/cvat --apply

`--apply` writes the databases and rewrites the manifest. It does not delete the
files: the databases are a new name beside the old ones, so until the map has
been seen drawing from them the whole move is one `git checkout` away from being
undone. What to remove, once it has, is printed at the end.

It also handles a store from before the tiles were divided per acquisition,
where everything shares one `<z>/<x>/<y>` tree. A tile carries no provenance, so
what says who wrote it is the acquisitions' footprints: a tile is the one whose
mask reaches it. That is exact wherever the footprints are disjoint, which over
a curated old store is almost everywhere. Where two masks reach one tile it
genuinely could be either — whichever ran last won, and nothing on disk records
which. Those tiles are dropped and their work units handed back, so the next
`--get` rebuilds them under each owner. It is a handful of units at the edges.

Deletable once no store of loose files remains.
"""

import argparse
import json
import sys
from pathlib import Path

import build_tiles
import coverage as coverage_mod
from acquisitions import slug
from vatcache import plural, size, spaced


def manifest_levels(manifest):
    """Acquisition name to the levels the manifest says are built for it.

    Every shape a manifest has had: the `acquisitions` block with or without a
    `path`, and the single-acquisition manifest from before there was a block.
    A store old enough to need packing may be old enough to predate either."""
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


def divided(manifest):
    """Does every acquisition have a tree of its own? A `path` on each entry is
    what says so — it is written by the run that divides them."""
    block = manifest.get("acquisitions")
    if not isinstance(block, dict):
        return False
    return all(isinstance(e, dict) and e.get("path") for e in block.values())


def agrees_before_packing(have, unit_tiles):
    """Was this manifest written by this code, give or take the container?

    `settings` names the container now, so its digest cannot match a manifest
    from before there was one — which is the point everywhere except here.
    Reproducing the pre-MBTiles digest is how this run tells a store waiting to
    be packed from one built under a recipe that has since changed in some other
    way, which it has to refuse: packing that would produce databases whose
    manifest claims a recipe their pixels were not made under."""
    recipe = build_tiles.settings([build_tiles.COARSEST_LEVEL], unit_tiles)
    recipe.pop("container")
    digest = build_tiles._digest(recipe)
    single = have.get("acquisition") if "acquisitions" not in have else None
    return have.get("digest") in (
        digest, build_tiles._digest(recipe, single) if single else None)


def file_tiles(root, z):
    """Every tile file under one `<z>` tree: (x, y, path), paths only.

    Paths rather than bytes, because a level of the largest acquisition is
    gigabytes and the packing reads it one work unit at a time."""
    found = []
    level = Path(root) / str(z)
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


def file_units(out, project, z):
    """The finished-unit markers, off the tree `build_tiles.py` used to keep
    them in. Its own reader, because the one in `build_tiles` now asks the
    database — which is exactly what this run is here to create."""
    found = set()
    marks = Path(out) / ".units" / slug(project) / str(z)
    for mark in marks.glob("*_*"):
        ux, _, uy = mark.name.partition("_")
        try:
            found.add((int(ux), int(uy)))
        except ValueError:
            continue
    return found


def claimants(masks, levels, z, x, y):
    """Which acquisitions' footprints reach this tile at this level. A tile is
    one tile of a one-tile unit, so the unit geometry answers it unchanged."""
    box = build_tiles.unit_bbox(z, x, y, 1)
    return [name for name, mask in masks.items()
            if z in levels[name] and mask.reaches(*box)]


def load_masks(names):
    """Each acquisition's footprint, derived if it is not beside the script.
    Minutes and one catalogue query apiece, against the hours the tiles took."""
    masks = {}
    for name in names:
        mask = build_tiles.Coverage(coverage_mod.load_or_build(name))
        if mask.project not in (None, name):
            sys.exit(f"coverage-{slug(name)}.npz is the footprint of "
                     f"{mask.project!r}, not {name!r}. Delete it and re-run.")
        masks[name] = mask
    return masks


def pack_level(store, z, tiles, marked, unit_tiles):
    """One level's files into one database, unit by unit.

    By unit because that is how the store records its progress and how a repair
    hands work back, and because it bounds what is held in memory to sixteen
    tiles at a time.

    A tile no finished unit covers is packed all the same. It is drawn today —
    `file_server` serves whatever is there — and dropping it here would turn a
    curiosity the audit already reports into a hole in the map.

    A finished unit holding no file is recorded all the same, for the older
    reason: "the footprint does not reach here" is a result, and a unit missing
    from the table is one the next build redoes.

    Returns the tiles packed and the bytes they came to."""
    by_unit = {}
    for x, y, path in tiles:
        by_unit.setdefault(build_tiles.unit_of((x, y), unit_tiles), []).append(
            (x, y, path))

    packed = written = 0
    for (ux, uy), group in by_unit.items():
        packed += len(group)
        # A report stats rather than reads: the whole store is tens of
        # gigabytes, and the figure it wants is how much there is to move.
        if store is None:
            written += sum(path.stat().st_size for _, _, path in group)
            continue
        blobs = [(x, y, path.read_bytes()) for x, y, path in group]
        written += sum(len(b) for _, _, b in blobs)
        if (ux, uy) in marked:
            store.write_unit(z, ux, uy, blobs)
        else:
            store.write_tiles(z, blobs)
    if store is not None:
        for ux, uy in marked - set(by_unit):
            store.write_unit(z, ux, uy, [])
    return packed, written


def attribute(out, levels, masks, unit_tiles):
    """The shared tree, split by footprint: acquisition to level to its tiles,
    plus the units whose tiles two footprints both reach.

    Held as paths, so this is a few tens of megabytes for a whole store and the
    reading still happens one unit at a time."""
    mine = {name: {} for name in levels}
    contested, orphans = {}, 0
    for z in sorted({z for zs in levels.values() for z in zs}, reverse=True):
        tiles = file_tiles(out, z)
        if not tiles:
            continue
        for x, y, path in tiles:
            owners = claimants(masks, levels, z, x, y)
            if len(owners) == 1:
                mine[owners[0]].setdefault(z, []).append((x, y, path))
            elif owners:
                unit = (x // unit_tiles, y // unit_tiles)
                for name in owners:
                    contested.setdefault((name, z), set()).add(unit)
            else:
                orphans += 1
        said = ", ".join(f"{slug(n)} {len(mine[n].get(z, []))}" for n in levels
                         if mine[n].get(z))
        print(f"  z{z}  {spaced(len(tiles))} tiles  {said or '—'}")
    return mine, contested, orphans


def main():
    p = argparse.ArgumentParser(
        prog="pack_store",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("store", help="the tile store to pack")
    p.add_argument("--apply", action="store_true",
                   help="write the databases; without it, only report")
    p.add_argument("--unit-tiles", type=int, default=build_tiles.DEFAULT_UNIT_TILES,
                   help="tiles along one side of a work unit, as it was built")
    args = p.parse_args()

    out = Path(args.store)
    manifest_path = out / "manifest.json"
    if not manifest_path.exists():
        sys.exit(f"no manifest in {out}; there is no store here to pack.")
    manifest = json.loads(manifest_path.read_text())

    if "container" in manifest:
        print(f"{manifest_path} already names a container; this store is "
              "packed.")
        return

    levels = manifest_levels(manifest)
    if not levels:
        sys.exit("the manifest names no acquisition, so nothing on disk can be "
                 "attributed to one.")

    # Before anything is written, because the manifest is rewritten last: a
    # recipe that had drifted for some other reason would otherwise be
    # discovered only once the databases claimed it.
    if not agrees_before_packing(manifest, args.unit_tiles):
        sys.exit(
            f"{manifest_path} (digest {manifest.get('digest')}) was written "
            "under a different recipe\nthan this code computes. Packing it "
            "would produce databases whose manifest cannot\nbe rewritten. "
            "Check out the commit it was built from, or settle the recipe "
            "first."
        )

    shared = not divided(manifest)
    print(f"{out}  {plural(len(levels), 'acquisition')}, "
          f"{'one shared tile namespace' if shared else 'divided'}\n")
    for name, zs in levels.items():
        print(f"  {name}  →  {slug(name)}{build_tiles.STORE_SUFFIX}  "
              f"z{max(zs)}–z{min(zs)}")
    print()

    contested, orphans = {}, 0
    if shared:
        mine, contested, orphans = attribute(
            out, levels, load_masks(levels), args.unit_tiles)
        print()
    else:
        mine = {name: {z: file_tiles(out / slug(name), z) for z in zs}
                for name, zs in levels.items()}

    total_tiles = total_bytes = 0
    for name, zs in levels.items():
        store = None
        if args.apply:
            store = build_tiles.Store(
                build_tiles.store_path(out, name), write=True)
        print(f"  {name}")
        try:
            for z in zs:
                marked = file_units(out, name, z)
                packed, written = pack_level(
                    store, z, mine[name].get(z, []), marked, args.unit_tiles)
                total_tiles += packed
                total_bytes += written
                print(f"    z{z}  {spaced(packed)} tiles  {size(written)}  "
                      f"{spaced(len(marked))} units")
            if store:
                store.stamp(name)
                # The one assertion worth making: every file that was read is a
                # row that can be read back. A y-flip that disagreed with itself
                # would still round-trip, but a tile lost on the way in would
                # not.
                held = sum(len(store.coords(z)) for z in zs)
                if held != sum(len(mine[name].get(z, [])) for z in zs):
                    print(f"    WARNING: {spaced(held)} tiles in the database, "
                          "not the number read")
        finally:
            if store:
                store.close()
    print()

    print(f"  {spaced(total_tiles)} tiles, {size(total_bytes)}, "
          f"{plural(len(levels), 'database')}")
    if orphans:
        print(f"  {spaced(orphans)} tiles reach no acquisition's footprint — "
              "left where they are, nothing claims them")
    if contested:
        units = sum(len(u) for u in contested.values())
        print(f"\n  {plural(units, 'work-unit claim')} cover tiles two "
              "footprints both reach. Those\n  tiles cannot be attributed, so "
              "the units are handed back whole — including\n  the tiles in "
              "them that were attributable, which a rebuild will write again:")
        for (name, z), us in sorted(contested.items()):
            print(f"    z{z}  {plural(len(us), 'unit')}  {name}")

    if not args.apply:
        print("\nNothing written. Re-run with --apply.")
        return

    for (name, z), us in contested.items():
        build_tiles.unmark(out, name, z, sorted(us), args.unit_tiles)

    # Aside rather than overwritten, so the one irreversible-looking step in
    # this run is not. It also means the first `open_manifest` below writes a
    # fresh file instead of being refused for carrying the old recipe: nothing
    # is lost by that, because every acquisition the old manifest named is in
    # `levels` and is about to be written back.
    manifest_path.replace(manifest_path.with_suffix(".json.pre-pack"))
    # Per acquisition, because `open_manifest` is the one place that knows the
    # slug rule and the level merge.
    for name, zs in levels.items():
        build_tiles.open_manifest(out, name, zs, args.unit_tiles, force=False)
    print(f"\n{manifest_path} rewritten; the previous one is "
          f"{manifest_path.name}.pre-pack.")

    stale = [str(out / slug(name)) for name in levels
             if (out / slug(name)).is_dir()]
    stale += [str(out / str(z)) for z in
              sorted({z for zs in levels.values() for z in zs}, reverse=True)
              if (out / str(z)).is_dir()]
    stale.append(str(out / ".units"))
    print("The loose files are untouched and, once Caddy hands /cvat/* to the "
          "sidecar,\nno longer served. When the map has been seen drawing from "
          "the databases:\n  rm -rf " + " ".join(stale))
    if contested:
        print("Then run the affected acquisitions again to refill the "
              "handed-back units.")


if __name__ == "__main__":
    main()
