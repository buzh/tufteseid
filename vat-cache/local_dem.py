"""Float DEM patches out of an acquisition's own delivered GeoTIFFs.

`fetch_dem.fetch` asks hoydedata.no to render one window per work unit — ~90 GB
of float TIFF over a full ladder, fetched again on every `--redo`, off the
service that falls over overnight. `Store.fetch` answers the same square, the
same pixels and the same NaN-for-no-coverage off local disk, out of what
`export.py` ordered once.

**Nothing in a delivery says where the ground stops.** The files declare no
nodata and the area the flight never reached is filled with exact `0.0` — a
legal elevation, which is why it cannot simply be trusted as terrain. It is
read as nodata here, so a shoreline pixel that really is 0.000000 is lost;
measured on NDH Jonsnuten, where a corner sheet came back 100 % zeros and no
NaN at all.

**A missing sheet is not empty ground.** The two are the same NaN to the
renderer, and a half-downloaded acquisition would build clean tiles over the
part that never arrived. `gaps` is the guard: it compares the footprint
against what is on disk before a build starts, rather than leaving the hole to
be found in the map.
"""

from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject
from rasterio.windows import Window, from_bounds as window_from_bounds

from export import ASIDE, extent_of, tiff_header
from report import spaced

# What fills ground the flight never reached. Not declared anywhere in the
# delivery; measured.
FILL = 0.0

# Source pixels of margin on a read, so resampling at the window's edge has
# neighbours on both sides rather than inventing them.
PAD_PX = 4

# Past this ratio of destination cell to source cell, a bilinear sample reads
# one source pixel in N and aliases; averaging is what an overview would do.
AVERAGE_ABOVE = 1.5


class Store:
    """An acquisition's delivered rasters, indexed by the ground they cover."""

    def __init__(self, root):
        self.root = Path(root)
        self.sheets = []
        cells = []
        for path in sorted(self.root.rglob("*")):
            if path.suffix.lower() not in (".tif", ".tiff"):
                continue
            if ASIDE.search(path.relative_to(self.root).as_posix()):
                continue
            head = tiff_header(path)
            box = extent_of(head)
            if box:
                self.sheets.append((box, path))
                cells.append(head["cell"][0])
        # The finest, if a delivery ever mixes two; `export.py --inspect` is
        # where a mix gets reported.
        self.cell = min(cells, default=None)

    def __len__(self):
        return len(self.sheets)

    def over(self, west, south, east, north):
        return [p for (bw, bs, be, bn), p in self.sheets
                if bw < east and be > west and bs < north and bn > south]

    def fetch(self, cx, cy, side_m, px, project=None, timeout=None):
        """A square of DEM centred on (cx, cy) in EPSG:25833, px x px cells.

        Signature of `fetch_dem.fetch`, so the two are interchangeable;
        `project` and `timeout` are accepted and unused, there being one
        acquisition per store and no service to wait for."""
        half = side_m / 2
        west, south = cx - half, cy - half
        east, north = cx + half, cy + half
        out = np.full((px, px), np.nan, np.float32)
        hits = self.over(west, south, east, north)
        if not hits:
            return out

        want = from_bounds(west, south, east, north, px, px)
        for path in hits:
            with rasterio.open(path) as src:
                pad = PAD_PX * src.res[0]
                window = window_from_bounds(
                    west - pad, south - pad, east + pad, north + pad,
                    src.transform,
                )
                window = window.round_offsets().round_lengths()
                window = window.intersection(
                    Window(0, 0, src.width, src.height))
                if window.width < 1 or window.height < 1:
                    continue
                patch = src.read(1, window=window)
                how = (Resampling.average
                       if side_m / px > AVERAGE_ABOVE * src.res[0]
                       else Resampling.bilinear)
                reproject(
                    source=patch,
                    destination=out,
                    src_transform=src.window_transform(window),
                    src_crs=src.crs,
                    src_nodata=FILL,
                    dst_transform=want,
                    dst_crs=src.crs,
                    dst_nodata=float("nan"),
                    # The square may need several sheets; each writes only
                    # where it has ground and leaves the rest alone.
                    init_dest_nodata=False,
                    resampling=how,
                )
        return out

    def gaps(self, coverage, step=200.0):
        """Ground inside the footprint that no delivered sheet covers, in km².

        Walks the footprint mask rather than the sheet grid, so it is the same
        answer whatever the delivery was cut into."""
        mask, x0, y0, cell = (coverage.mask, coverage.x0, coverage.y0,
                              coverage.cell)
        stride = max(1, int(round(step / cell)))
        rows, cols = np.nonzero(mask[::stride, ::stride])
        missing = 0
        for row, col in zip(rows.tolist(), cols.tolist()):
            x = x0 + (col * stride + 0.5) * cell
            y = y0 + (row * stride + 0.5) * cell
            if not any(bw <= x <= be and bs <= y <= bn
                       for (bw, bs, be, bn), _ in self.sheets):
                missing += 1
        per = (stride * cell) ** 2 / 1e6
        return missing * per, len(rows) * per


def source_note(root, store):
    """What went into the recipe, so a database says where its pixels came from.

    The digest covers this, so a build off local files will not quietly extend
    one built off the service."""
    return (f"local delivery, {len(store)} GeoTIFFs under {Path(root).name}, "
            f"{store.cell} m, fill {FILL} read as no data")


def summarise(store):
    if not store.sheets:
        return "no rasters"
    west = min(b[0] for b, _ in store.sheets)
    south = min(b[1] for b, _ in store.sheets)
    east = max(b[2] for b, _ in store.sheets)
    north = max(b[3] for b, _ in store.sheets)
    ground = sum((b[2] - b[0]) * (b[3] - b[1]) for b, _ in store.sheets) / 1e6
    return (f"{len(store)} rasters, {store.cell} m, "
            f"{spaced(round(ground))} km² over "
            f"{(east - west) / 1000:.1f} x {(north - south) / 1000:.1f} km")
