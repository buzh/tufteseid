import { getHeight, getWidth } from 'ol/extent';
import { get as getProjection } from 'ol/proj';
import TileGrid from 'ol/tilegrid/TileGrid';

// Every WMS in this app renders on the fly, so what a screenful costs is
// set by the number of requests far more than by the number of pixels.
// At OpenLayers' default 256 px a 1600x1000 viewport is ~35 tiles per
// layer per zoom level, and in LiDAR project mode two WMS layers are
// stacked (the faded national mosaic under the project) — 70 requests
// for one zoom step, before the theme layers.
//
// That matters because wms.geonorge.no rate-limits by source IP, which
// is the server, shared by every visitor. Measured: ~120 GetMaps in a
// short window is the budget, and over it the answer is HTTP 200 with a
// 238-byte ServiceException that the browser cannot decode as a PNG.
// OpenLayers marks the tile ERROR and never retries it, so it stays a
// hole. Two zoom steps used to be enough to trip it.
//
// 512 px quarters the request count for the same ground. It is not a
// bandwidth trade: one 512 px hillshade tile measured 146 060 bytes
// against 4x ~36 800 for the 256 px tiles covering the same area, i.e.
// the same bytes in a quarter of the requests. Wall-clock came out equal
// or better in every one of six cold trials, and only the 256 px runs
// produced long-tail outliers (one at 30.2 s) — a screenful's worst case
// is the slowest tile in it, so fewer tiles means fewer chances to draw
// a slow one.
//
// The request stays 512x512 on every display: TileWMS pins its pixel
// ratio to 1 unless `serverType` is set, and none of these sources sets
// one. Should that ever change, both wms.geonorge.no and kart.ra.no were
// checked at the 1024x1024 it would then ask for and answer normally.
const WMS_TILE_SIZE = 512;

// OpenLayers derives a View's default resolutions from the projection
// extent divided by *256* whatever the tile size in use, so this constant
// is the view's zoom-level scale and has nothing to do with WMS_TILE_SIZE
// above. Keeping the grid on exactly these resolutions is what makes a
// tile land on the pixel grid at integer zoom; a grid of its own would
// resample every tile.
const VIEW_TILE_SIZE = 256;

// One past the View's maxZoom (20), so every zoom the user can reach has
// a resolution at its own index.
const LEVELS = 21;

const cache = new Map<string, TileGrid | null>();

const build = (projectionCode: string): TileGrid | null => {
  const projection = getProjection(projectionCode);
  const extent = projection?.getExtent();
  // No extent means the View is on its whole-world fallback rather than
  // a projection-derived resolution ladder, and a grid built on a guess
  // would misalign every tile. Fall back to OpenLayers' default instead.
  if (!extent) return null;

  // Mirrors View's own createResolutionConstraint: max of the two spans,
  // not the width.
  const maxResolution =
    Math.max(getWidth(extent), getHeight(extent)) / VIEW_TILE_SIZE;

  return new TileGrid({
    extent,
    origin: [extent[0], extent[3]],
    resolutions: Array.from(
      { length: LEVELS },
      (_, z) => maxResolution / 2 ** z,
    ),
    tileSize: WMS_TILE_SIZE,
  });
};

// The shared 512 px tile grid for a projection, or undefined to leave the
// source on OpenLayers' default grid. Memoised because every background
// swap and every theme layer toggle builds new sources.
export const getWMSTileGrid = (
  projectionCode: string,
): TileGrid | undefined => {
  if (!cache.has(projectionCode)) {
    cache.set(projectionCode, build(projectionCode));
  }
  return cache.get(projectionCode) ?? undefined;
};

// Which of the two bracketing levels a renderer asks for when the view
// resolution falls between them — 1 meaning the coarser one.
//
// At rest this does nothing at all: the View has constrainResolution, so
// it always settles on a level whose resolution this grid matches
// exactly, and an exact match returns that level whatever the direction
// (linearFindNearest in ol/array.js). It only bites during the 250 ms
// zoom animation, which is where the waste was. Measured before: a
// single notch from z13 to z12 fetched the 35 tiles z12 actually needs
// *plus* a 19-tile ring at z13 — because the visible extent grows
// throughout the animation while the rounded-to-nearest level is still
// z13 for the first half of it. Preferring the coarser level means a
// zoom-out heads straight for its destination level and a zoom-in keeps
// drawing the level it already has until it arrives.
export const WMS_Z_DIRECTION = 1;

// Tiles a layer renderer keeps after they leave the viewport, and the
// direct answer to "tiles that were there before disappeared". OpenLayers
// renders a level it has no tiles for by borrowing from the layer cache —
// but only from parents, plus a single level of children — so a cache
// that has aged out the coarser levels leaves nothing to draw while the
// new ones load.
//
// 128 is ~10 screenfuls at 512 px, against the default 512 entries which
// at that tile size would be four times the pixels the default was
// budgeted for.
export const WMS_TILE_CACHE_SIZE = 128;
