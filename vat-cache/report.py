
import sqlite3
import sys
import time
from pathlib import Path

import build_tiles
import coverage as coverage_mod

def spaced(n):
    return f"{n:,}".replace(",", " ")

def plural(n, one, many=None):
    return f"{spaced(n)} {one if n == 1 else (many or one + 's')}"

def size(nbytes):
    if nbytes >= 1e9:
        return f"{nbytes / 1e9:.2f} GB"
    if nbytes >= 1e6:
        return f"{nbytes / 1e6:.1f} MB"
    return f"{nbytes / 1e3:.0f} kB"

def level_range(levels):
    if not levels:
        return "—"
    if len(levels) == 1:
        return f"z{levels[0]}"
    if len(levels) == max(levels) - min(levels) + 1:
        return f"z{max(levels)}–z{min(levels)}"
    return ", ".join(f"z{z}" for z in sorted(levels, reverse=True))

def held(out):
    path = coverage_mod.load_or_build(project)
    mask = build_tiles.Coverage(path)
    if mask.project is None:
        sys.exit(
            f"{path.name} carries no acquisition name, so it cannot be checked "
            f"against {project!r}.\nDelete it and the next run derives one: "
            f"rm {path}"
        )
    return mask

def ticker(z):
    last = [0.0]

    def tick(seen, total):
        now = time.perf_counter()
        if now - last[0] < 0.5 and seen < total:
            return
        last[0] = now
        print(f"\r  z{z} scanning {seen}/{total} units…", end="", flush=True)

    return tick

def check(out, project, levels, unit_tiles, verbose, mask=None):
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
    return {r.z: r.repairable for r in reports if r.repairable}
