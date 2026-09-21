// The breaker, applied to a tile source.
//
// Both halves of the loop live in one place, and they have to: admission and
// reporting must agree about which requests are real. Reading failures off the
// source's `tileloaderror` event instead would count the tiles this file
// refused, and an origin that was merely quiet would be held down by the
// evidence of its own being held down.

import { getDefaultStore } from 'jotai';
import type ImageTile from 'ol/ImageTile';
import Layer from 'ol/layer/Layer';
import type TileImage from 'ol/source/TileImage';
import TileState from 'ol/TileState';
import { mapAtom } from '../map/atoms';
import {
  mayRequest,
  onOriginRecovered,
  reportFailure,
  reportSuccess,
} from './health';
import { originForUrl, type OriginId } from './origins';

/** Stamped on the source so recovery can find it again. */
const GUARD_PROP = 'upstreamOrigin';

/**
 * Put `source` behind the breaker for whichever origin `url` belongs to. A URL
 * no origin claims is left alone — the source keeps OpenLayers' own loader.
 *
 * Called by the four background builders and by the theme builder, with the
 * URL each of them already has in hand.
 */
export const guardTileSource = (source: TileImage, url: string): void => {
  const origin = originForUrl(url);
  if (!origin) return;
  source.set(GUARD_PROP, origin);

  source.setTileLoadFunction((tile, src) => {
    if (!mayRequest(origin)) {
      // Not a deferral: OpenLayers keeps no queue of its own for this, and a
      // tile left LOADING would hold one of the sixteen slots the whole map
      // shares. ERROR frees the slot and is undone by `refresh()` below.
      tile.setState(TileState.ERROR);
      return;
    }
    const image = (tile as ImageTile).getImage() as HTMLImageElement;
    // Ours are additional to the ones OpenLayers attaches after this returns;
    // it still drives the tile's own state.
    image.addEventListener('load', () => reportSuccess(origin), { once: true });
    image.addEventListener('error', () => reportFailure(origin), {
      once: true,
    });
    image.src = src;
  });
};

// Walked rather than kept in a registry of our own: the map's collection is by
// definition the set of sources that can still put something on screen, and a
// swapped-out ground should neither be refreshed nor kept alive by us.
const refreshSourcesFor = (origin: OriginId) => {
  const map = getDefaultStore().get(mapAtom);
  for (const layer of map.getLayers().getArray()) {
    if (!(layer instanceof Layer)) continue;
    const source = layer.getSource();
    if (source?.get(GUARD_PROP) === origin) source.refresh();
  }
};

// Module scope, so importing the guard is all a caller has to do. There is one
// breaker set and one map, so there is one listener.
onOriginRecovered(refreshSourcesFor);
