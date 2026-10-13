import { getHeight, getWidth } from 'ol/extent';
import { get as getProjection } from 'ol/proj';
import TileGrid from 'ol/tilegrid/TileGrid';

const WMS_TILE_SIZE = 512;

const VIEW_TILE_SIZE = 256;

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

  const maxResolution =
    Math.max(getWidth(extent), getHeight(extent)) / VIEW_TILE_SIZE;

  return new TileGrid({
    extent,
    origin: [extent[0], extent[3]],

    resolutions: Array.from(
      { length: maxZoom + 1 },
      (_, z) => maxResolution / 2 ** z,
    ),
    tileSize: WMS_TILE_SIZE,
    minZoom,
  });
};

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

export const WMS_Z_DIRECTION = 1;

export const WMS_TILE_CACHE_SIZE = 128;
