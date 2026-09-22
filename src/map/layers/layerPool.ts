import type BaseLayer from 'ol/layer/Base';
import type TileLayer from 'ol/layer/Tile';
import type OlMap from 'ol/Map';

// Layers taken off a map, kept for the moment the reader asks for them back.
//
// A tile cache belongs to the layer, so removing one throws away everything it
// had loaded. Ticking a Kulturminner register off and on, moving between the
// curtain and the split, going to a second ground and back — each of those
// costs a fresh screenful of GetMap against upstreams this deployment shares
// one rate limit for, and none of them are rare. They are how the app is read.
//
// Reuse already exists for the case where the layer never left: both the
// background swap and the theme sync look for an equivalent layer in the map's
// own collection before building one. This is that same trade one step further
// out, for the layers that have been removed but whose pixels are still good.
//
// Held by signature rather than by map. An OL layer belongs to one map at a
// time and a pooled layer belongs to none, so the split view's pane can take
// back the instance the main map just retired — which is the curtain/split case
// and the reason this lookup may cross hosts while the in-collection one must
// not: a hit in another live map would be an instance stolen from under
// whatever is drawing it.

/**
 * The property a layer carries "these two would render the same pixels" in.
 * The in-collection lookups key off the same value, so a layer is poolable
 * exactly when it is reusable; one without a key is simply dropped.
 */
export const POOL_KEY = 'poolKey';

// Room for a whole background stack (base, faded fallback, featured dataset,
// hybrid overlay) and a whole B stack beside it, which is the most a single
// toggle can retire at once. Past that the memory is real: the tile cache sits
// on the layer's renderer, nothing prunes it while the layer is not rendering,
// and it holds whatever was in it when the layer left — a screenful plus recent
// panning, up to the `cacheSize` the builders set.
const MAX_POOLED = 8;

// A change of mind is seconds; a reader who made one an hour ago is holding
// tiles for nothing. One timer per entry rather than a sweep on the next
// insert, because the case that matters — toggle once, never touch the pool
// again — is exactly the one a lazy sweep never reaches.
const POOL_TTL_MS = 300000;

type PooledLayer = { layer: TileLayer; timer: number };

// Insertion-ordered, so the first key is the oldest. Taking a layer deletes its
// entry, so a reused layer goes back in at the end when it is next retired.
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

/**
 * Take a layer off `map` and keep it if it is worth keeping.
 *
 * Only what actually came off is pooled: a layer still in some collection would
 * be handed to a second map on the next take, and OL would move it there,
 * blanking the first.
 */
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

/** The pooled layer for this signature, removed from the pool. Null if there is
 *  none — two builds racing for one entry means the second builds. */
export const takePooledLayer = (key: string): TileLayer | null => {
  const entry = pool.get(key);
  if (!entry) return null;
  drop(key);
  return entry.layer;
};
