import { getHeight, getWidth } from 'ol/extent';
import { get as getProjection } from 'ol/proj';
import TileGrid from 'ol/tilegrid/TileGrid';

// wms.geonorge.no rate-limits by source IP at roughly 120 GetMaps in a short
// window; over it the answer is HTTP 200 with a 238-byte ServiceException,
// which OpenLayers marks tile ERROR and never retries. 512 px quarters the
// request count, and TileWMS pins its pixel ratio to 1 unless `serverType` is
// set, so this stays 512 on any display.
const WMS_TILE_SIZE = 512;

// The View's zoom ladder divides the extent by 256 whatever tile size is in
// use; any other value resamples.
const VIEW_TILE_SIZE = 256;

// The View's maxZoom, and so the last level a source is ever asked for.
export const VIEW_MAX_ZOOM = 20;

const cache = new Map<string, TileGrid | null>();

const build = (
  projectionCode: string,
  minZoom: number,
  maxZoom: number,
): TileGrid | null => {
  const projection = getProjection(projectionCode);
  const extent = projection?.getExtent();
  if (!extent) return null;

  // Mirrors View's createResolutionConstraint: max of the two spans, not width.
  const maxResolution =
    Math.max(getWidth(extent), getHeight(extent)) / VIEW_TILE_SIZE;

  return new TileGrid({
    extent,
    origin: [extent[0], extent[3]],
    // Indexed by absolute z: a source holding only deep levels still gets the
    // whole array, fenced off by minZoom and the array's end.
    resolutions: Array.from(
      { length: maxZoom + 1 },
      (_, z) => maxResolution / 2 ** z,
    ),
    tileSize: WMS_TILE_SIZE,
    minZoom,
  });
};

// undefined means OpenLayers' own default grid.
export const getWMSTileGrid = (
  projectionCode: string,
  minZoom = 0,
  maxZoom = VIEW_MAX_ZOOM,
): TileGrid | undefined => {
  const key = `${projectionCode}|${minZoom}|${maxZoom}`;
  if (!cache.has(key)) {
    cache.set(key, build(projectionCode, minZoom, maxZoom));
  }
  return cache.get(key) ?? undefined;
};

// Which bracketing level a renderer asks for between two resolutions; 1 is the
// coarser.
export const WMS_Z_DIRECTION = 1;

// Tiles kept after they leave the viewport, ~10 screenfuls at 512 px. A level
// with no tiles borrows from its parents, so aging those out leaves a hole.
export const WMS_TILE_CACHE_SIZE = 128;
