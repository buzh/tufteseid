"""Reading a built acquisition back, and saying what is there.

Shared by the two front ends, because an audit is the same question wherever the
database sits: `vatcache.py` asks it of the store the server serves, `makevat.py`
of a file that has not been copied anywhere yet. Neither of them knows anything
the other does not about what makes a level whole.

Everything here takes a directory and an acquisition name, which together are
the database (`build_tiles.store_path`). That is the only coupling: there is no
manifest, no queue and no store in any of it.
"""

import sqlite3
import sys
import time
from pathlib import Path

import build_tiles
import coverage as coverage_mod


# ---------------------------------------------------------------------------
# Figures, written the way the README and the docs write them
# ---------------------------------------------------------------------------


def spaced(n):
    """1 106, the way the figures are written in the README and the docs."""
    return f"{n:,}".replace(",", " ")


def plural(n, one, many=None):
    return f"{spaced(n)} {one if n == 1 else (many or one + 's')}"


def size(nbytes):
    """A store runs to hundreds of megabytes per level; a pilot to a handful,
    and a two-unit trial to nothing at all."""
    if nbytes >= 1e9:
        return f"{nbytes / 1e9:.2f} GB"
    if nbytes >= 1e6:
        return f"{nbytes / 1e6:.1f} MB"
    return f"{nbytes / 1e3:.0f} kB"


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


# ---------------------------------------------------------------------------
# What a directory of databases holds
# ---------------------------------------------------------------------------


def held(out):
    """Acquisition name to the levels the databases in this directory hold.

    Read out of each file's own stamp, which is the same row the sidecar reads
    when it builds `/cvat/manifest.json` — so this is what the app will be
    offered, rather than an inventory kept alongside and capable of disagreeing
    with the files. It is also why an acquisition can arrive by being copied in:
    nothing here has to be told about it."""
    found = {}
    for path in sorted(Path(out).glob(f"*{build_tiles.STORE_SUFFIX}")):
        try:
            with build_tiles.Store(path) as store:
                name = store.meta("name")
                if not name:
                    print(f"warning: {path.name} names no acquisition, so "
                          "nothing can join onto it", file=sys.stderr)
                    continue
                found[name] = store.levels()
        except sqlite3.DatabaseError as err:
            print(f"warning: {path.name} does not read ({err})",
                  file=sys.stderr)
    return found


# ---------------------------------------------------------------------------
# The footprint
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


# ---------------------------------------------------------------------------
# The audit
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


def check(out, project, levels, unit_tiles, verbose, mask=None):
    """Every named level of one acquisition, printed as it goes."""
    mask = mask or mask_for(project)
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


def orphans(out, project, levels, unit_tiles):
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
        stray = on_disk - claimed
        if stray:
            sample = ", ".join(f"{x}/{y}" for x, y in sorted(stray)[:5])
            print(f"  z{z}  {plural(len(stray), 'tile belongs', 'tiles belong')} "
                  f"to no finished unit ({sample}…)")


def repairable(reports):
    """Level to units, for the levels that have something to rebuild."""
    return {r.z: r.repairable for r in reports if r.repairable}
