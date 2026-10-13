import type BaseLayer from 'ol/layer/Base';
import type TileLayer from 'ol/layer/Tile';
import type OlMap from 'ol/Map';

export const POOL_KEY = 'poolKey';

const MAX_POOLED = 8;

const POOL_TTL_MS = 300000;

type PooledLayer = { layer: TileLayer; timer: number };

const pool = new Map<string, PooledLayer>();

const drop = (key: string) => {
  const entry = pool.get(key);
  if (!entry) return;
  window.clearTimeout(entry.timer);
  pool.delete(key);
};

const keyOf = (layer: BaseLayer): string | null => {
  const key = layer.get(POOL_KEY);
  return typeof key === 'string' ? key : null;
};

export const retireLayer = (map: OlMap, layer: BaseLayer): void => {
  if (!map.removeLayer(layer)) return;
  const key = keyOf(layer);
  if (!key) return;
  drop(key);
  if (pool.size >= MAX_POOLED) {
    const oldest = pool.keys().next().value;
    if (oldest !== undefined) drop(oldest);
  }
  pool.set(key, {
    layer: layer as TileLayer,
    timer: window.setTimeout(() => drop(key), POOL_TTL_MS),
  });
};

export const takePooledLayer = (key: string): TileLayer | null => {
  const entry = pool.get(key);
  if (!entry) return null;
  drop(key);
  return entry.layer;
};
