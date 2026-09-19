import { getHeight, getWidth } from 'ol/extent';
import { get as getProjection } from 'ol/proj';
import TileGrid from 'ol/tilegrid/TileGrid';

// wms.geonorge.no rate-limits by source IP — here the server, shared by every
// visitor — at roughly 120 GetMaps in a short window; over it the answer is
// HTTP 200 with a 238-byte ServiceException, which OpenLayers marks tile ERROR
// and never retries. 512 px quarters the request count for the same bytes (one
// 512 tile is 146 kB against 4x ~37 kB). It stays 512 on any display: TileWMS
// pins its pixel ratio to 1 unless `serverType` is set, and none of these do.
const WMS_TILE_SIZE = 512;

// The view's own zoom ladder (its defaults divide the extent by 256 whatever
// tile size is in use, so unrelated to WMS_TILE_SIZE); any other resamples.
const VIEW_TILE_SIZE = 256;

// The View's maxZoom (20), and so the last level a source is ever asked for.
const MAX_ZOOM = 20;

const cache = new Map<string, TileGrid | null>();

const build = (
  projectionCode: string,
  minZoom: number,
  maxZoom: number,
): TileGrid | null => {
  const projection = getProjection(projectionCode);
  const extent = projection?.getExtent();
  // No extent means the View's whole-world fallback: a guessed grid misaligns.
  if (!extent) return null;

  // Mirrors View's createResolutionConstraint: max of the two spans, not width.
  const maxResolution =
    Math.max(getWidth(extent), getHeight(extent)) / VIEW_TILE_SIZE;

  return new TileGrid({
    extent,
    origin: [extent[0], extent[3]],
    // Indexed by absolute z, so a source holding only deep levels still gets
    // the whole array and is fenced off by minZoom and the array's end.
    resolutions: Array.from(
      { length: maxZoom + 1 },
      (_, z) => maxResolution / 2 ** z,
    ),
    tileSize: WMS_TILE_SIZE,
    minZoom,
  });
};

/**
 * The shared 512 px tile grid for a projection, or undefined for OpenLayers'
 * default. Memoised: every background swap builds new sources.
 *
 * The level range is for a store that holds only some of them — our own cached
 * ground. Clamping both ends means OL never asks for a level that was never
 * written: under the range it stops drawing, over it upsamples the deepest.
 */
export const getWMSTileGrid = (
  projectionCode: string,
  minZoom = 0,
  maxZoom = MAX_ZOOM,
): TileGrid | undefined => {
  const key = `${projectionCode}|${minZoom}|${maxZoom}`;
  if (!cache.has(key)) {
    cache.set(key, build(projectionCode, minZoom, maxZoom));
  }
  return cache.get(key) ?? undefined;
};

// Which bracketing level a renderer asks for between two resolutions; 1 is the
// coarser. During a zoom animation, nearest would also fetch the level left.
export const WMS_Z_DIRECTION = 1;

// Tiles kept after they leave the viewport, ~10 screenfuls at 512 px. A level
// with no tiles borrows from its parents, so aging those out leaves a hole.
export const WMS_TILE_CACHE_SIZE = 128;
