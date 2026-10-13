
import hashlib
import json
import sqlite3
import sys
import time
import urllib.error
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

import cvat
import fetch_dem
from acquisitions import slug

GRID_ORIGIN = (-2500000.0, 9045984.0)
MAX_RESOLUTION = 21664.0
TILE_PX = 512

OVERLAP_PX = 24

DEFAULT_UNIT_TILES = 4

DEFAULT_LEVELS = (16, 15, 14, 13, 12, 11, 10, 9, 8, 7)
COARSEST_LEVEL = 7
WEBP_QUALITY = 90

MASK_ALPHA_BELOW_Z = 12

def resolution(z):
    return MAX_RESOLUTION / 2**z

def levels_for(native_cell):
    side = tile_span(z) * unit_tiles
    west = GRID_ORIGIN[0] + ux * side
    north = GRID_ORIGIN[1] - uy * side
    return west, north - side, west + side, north

class Coverage:

    def __init__(self, path):
        self.path = str(path)
        data = np.load(path)
        self.mask = data["mask"]
        self.x0, self.x1, self.y0, self.y1 = (float(v) for v in data["bounds"])
        self.cell = float(data["cell"])

        self.project = str(data["project"]) if "project" in data.files else None

    def reaches(self, west, south, east, north):
        if east <= self.x0 or west >= self.x1 or north <= self.y0 or south >= self.y1:
            return False
        i0 = max(0, int((west - self.x0) / self.cell))
        i1 = min(self.mask.shape[1], int(np.ceil((east - self.x0) / self.cell)))
        j0 = max(0, int((south - self.y0) / self.cell))
        j1 = min(self.mask.shape[0], int(np.ceil((north - self.y0) / self.cell)))
        if i1 <= i0 or j1 <= j0:
            return False
        return bool(self.mask[j0:j1, i0:i1].any())

    def sample(self, west, south, east, north, px):
        side = tile_span(z) * unit_tiles
        ux0 = int(np.floor((self.x0 - GRID_ORIGIN[0]) / side))
        ux1 = int(np.floor((self.x1 - GRID_ORIGIN[0]) / side))
        uy0 = int(np.floor((GRID_ORIGIN[1] - self.y1) / side))
        uy1 = int(np.floor((GRID_ORIGIN[1] - self.y0) / side))
        out = []
        for uy in range(uy0, uy1 + 1):
            for ux in range(ux0, ux1 + 1):
                if self.reaches(*unit_bbox(z, ux, uy, unit_tiles)):
                    out.append((ux, uy))
        return out

def fetch_unit(z, ux, uy, unit_tiles, project, attempts=5, delay=2.0):
    res = resolution(z)
    west, south, east, north = unit_bbox(z, ux, uy, unit_tiles)
    grow = OVERLAP_PX * res
    side_m = (east - west) + 2 * grow
    px = unit_tiles * TILE_PX + 2 * OVERLAP_PX
    cx, cy = (west + east) / 2, (south + north) / 2
    for attempt in range(attempts):
        try:
            return fetch_dem.fetch(cx, cy, side_m, px, project=project)
        except (urllib.error.URLError, RuntimeError, ValueError, TimeoutError):
            if attempt == attempts - 1:
                raise

            time.sleep(delay * 2**attempt)

def encode_tile(field, footprint=None):

def store_path(out, project):
    256 tiles of 512 px wide at z9, so 2**(z-1)."""
    return 2 ** (z - 1)

def tms_row(z, y):
    in store coordinates. Rows come out the other way up from y, hence the swap."""
    x0, y0 = ux * unit_tiles, uy * unit_tiles
    return (x0, x0 + unit_tiles - 1,
            tms_row(z, y0 + unit_tiles - 1), tms_row(z, y0))

class Store:

    def __init__(self, path, write=False):
        self.path = Path(path)
        if write:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.db = sqlite3.connect(self.path, timeout=30)
            self.db.executescript(_SCHEMA)
        else:
            self.db = sqlite3.connect(f"file:{self.path}?mode=ro",
                                      uri=True, timeout=30)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        self.db.close()

    def levels(self):
        return [z for (z,) in self.db.execute(
            "SELECT DISTINCT zoom_level FROM tiles ORDER BY zoom_level DESC")]

    def meta(self, key):
        row = self.db.execute(
            "SELECT value FROM metadata WHERE name = ?", (key,)).fetchone()
        return row[0] if row else None

    def stamp(self, project, recipe=None):
        return {
            (ux, uy) for ux, uy in self.db.execute(
                "SELECT unit_x, unit_y FROM units WHERE zoom_level = ?", (z,))
        }

    def tiles_in(self, z, ux, uy, unit_tiles):
        x0, x1, r0, r1 = unit_rect(z, ux, uy, unit_tiles)
        rows = self.db.execute(
            "SELECT tile_column, tile_row, tile_data FROM tiles "
            "WHERE zoom_level = ? AND tile_column BETWEEN ? AND ? "
            "AND tile_row BETWEEN ? AND ?", (z, x0, x1, r0, r1))
        return [(x, tms_row(z, row), blob) for x, row, blob in rows]

    def coords(self, z):
        return {
            (x, tms_row(z, row)) for x, row in self.db.execute(
                "SELECT tile_column, tile_row FROM tiles WHERE zoom_level = ?",
                (z,))
        }

    def _put(self, z, tiles):
        self.db.executemany(
            "INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(zoom_level, tile_column, tile_row) "
            "DO UPDATE SET tile_data = excluded.tile_data",
            [(z, x, tms_row(z, y), blob) for x, y, blob in tiles])

    def write_unit(self, z, ux, uy, tiles):
        with self.db:
            for ux, uy in units:
                x0, x1, r0, r1 = unit_rect(z, ux, uy, unit_tiles)
                self.db.execute(
                    "DELETE FROM tiles WHERE zoom_level = ? "
                    "AND tile_column BETWEEN ? AND ? AND tile_row BETWEEN ? AND ?",
                    (z, x0, x1, r0, r1))
                self.db.execute(
                    "DELETE FROM units WHERE zoom_level = ? AND unit_x = ? "
                    "AND unit_y = ?", (z, ux, uy))

def read_store(out, project):
    if path not in _MASKS:
        _MASKS[path] = Coverage(path)
    return _MASKS[path]

def build_unit(args):
    from importlib.metadata import version

    return {
        "generator": "vat-cache/build_tiles.py",
        "renderer": f"rvt-py {version('rvt-py')}",
        "source": "hoydedata.no Prosjekt_DTM exportImage, pixelType=F32",
        "visualization": "RVT combined VAT (VAT_Combined.rft.xml)",
        "presets": cvat.VAT_PRESETS,
        "blend_order": ["Hillshade normal 100", "Slope luminosity 50",
                        "Openness+ overlay 50", "Sky-View multiply 25"],
        "overlay_opacity_note": (
            "rvt.blend_func.blend_overlay writes through its background, so the "
            "openness layer's 50 % performs as 100 %. That is RVT's own "
            "behaviour and is deliberately not corrected."),
        "sun_azimuth": cvat.SUN_AZIMUTH,
        "n_directions": cvat.N_DIRECTIONS,
        "ve_factor": cvat.VE_FACTOR,
        "combined_opacity": cvat.COMBINED_OPACITY,
        "radius_rule": "RVT max_rad in pixels, verbatim at every level",
        "grid": {
            "projection": "EPSG:25833",
            "origin": list(GRID_ORIGIN),
            "tile_px": TILE_PX,
            "max_resolution": MAX_RESOLUTION,
            "note": "src/map/layers/wmsTileGrid.ts; resolution = max_resolution / 2**z",
        },
        "encoding": f"RGBA WebP q{WEBP_QUALITY}, alpha is coverage",
        "container": ("MBTiles (SQLite) per acquisition, <path>.mbtiles; "
                      "tile_row is TMS, 2**(z-1) - 1 - y"),
        "overlap_px": OVERLAP_PX,
        "unit_tiles": unit_tiles,
        "levels": {
            str(z): {
                "m_per_px": round(resolution(z), 6),
                "tile_m": round(tile_span(z), 3),
                "overlap_m": round(OVERLAP_PX * resolution(z), 3),
                "radii": cvat.radii_for(resolution(z), radius_in_metres=False),
                "alpha": ("footprint mask" if z < MASK_ALPHA_BELOW_Z
                          else "DEM no-data"),
            }
            for z in levels
        },
    }

def recipe_digest(recipe):
    store = read_store(out, project)
    if store is None:
        return set()
    with store:
        return store.units(z)

def run_levels(store, project, coverage, levels, unit_tiles=DEFAULT_UNIT_TILES,
               jobs=1, limit=None, done=None):