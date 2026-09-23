// The breaker and the retry, applied to a tile source. Admission and reporting
// are both here because they have to agree about which requests are real:
// reading failures off `tileloaderror` would also count the tiles this file
// refused, holding a quiet origin down on the evidence of its own outage.
//
// OpenLayers asks for a tile once, so a dropped request leaves a hole until the
// page is reloaded; hence the retry. An `<img>` error carries no status, so a
// 404 meaning "no tile here" is indistinguishable from a 502 — a sparse store
// passes `retry: false`.

import { getDefaultStore } from 'jotai';
import type ImageTile from 'ol/ImageTile';
import Layer from 'ol/layer/Layer';
import type TileImage from 'ol/source/TileImage';
import type Tile from 'ol/Tile';
import TileState from 'ol/TileState';
import { mapAtom } from '../map/atoms';
import { peekSplitMap } from '../map/compare/splitMap';
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
 * Gap before each retry, before jitter. Its length is the retry count: a tile
 * is tried once, then once more per entry here.
 */
const RETRY_DELAY_MS = [400, 900];
/** Up to this much again, so a failed screenful does not retry in lockstep. */
const RETRY_JITTER_MS = 300;

/**
 * Tries spent on a tile so far. Keyed by the tile, because `load()` re-enters
 * the loader below with the same tile and a fresh image; weak, because the
 * source disposes its tiles on `refresh()` and `clear()`.
 */
const attempts = new WeakMap<Tile, number>();

type GuardOptions = {
  /** Whether a request that produced no picture is worth making again. */
  retry?: boolean;
  /**
   * A store holding the same tiles with nothing upstream behind it, as a
   * template differing from `url` only in the part that names the store. Given
   * one, a tile asked for while the breaker is open goes there instead.
   */
  heldUrl?: string;
};

/** Everything in a tile template before the first placeholder. */
const storePrefix = (template: string): string => {
  const cut = template.indexOf('{');
  return cut < 0 ? template : template.slice(0, cut);
};

/**
 * Put `source` behind the retry, and behind the breaker for whichever origin
 * `url` belongs to. A source in no origin row still gets the retry, which is
 * its only recourse — it has no probe and no `refresh()` behind it.
 */
export const guardTileSource = (
  source: TileImage,
  url: string,
  { retry = true, heldUrl }: GuardOptions = {},
): void => {
  const origin = originForUrl(url);
  if (origin) source.set(GUARD_PROP, origin);

  const livePrefix = storePrefix(url);
  const heldPrefix = heldUrl ? storePrefix(heldUrl) : null;

  source.setTileLoadFunction((tile, src) => {
    const image = (tile as ImageTile).getImage() as HTMLImageElement;

    if (origin && !mayRequest(origin)) {
      if (heldPrefix !== null && src.startsWith(livePrefix)) {
        // Neither reported nor counted as an attempt: nothing upstream is being
        // asked. `refreshSourcesFor` puts the layer back on the live store.
        image.src = heldPrefix + src.slice(livePrefix.length);
        return;
      }
      // Not a deferral: a tile left LOADING holds one of the sixteen slots the
      // whole map shares. ERROR frees it, and `refreshSourcesFor` undoes it.
      tile.setState(TileState.ERROR);
      return;
    }
    const attempt = (attempts.get(tile) ?? 0) + 1;
    attempts.set(tile, attempt);

    // Additional to the listeners OpenLayers attaches after this returns; it
    // still drives the tile's own state.
    image.addEventListener(
      'load',
      () => {
        attempts.delete(tile);
        if (origin) reportSuccess(origin);
      },
      { once: true },
    );
    image.addEventListener(
      'error',
      () => {
        // Every try that failed is reported, not just the last one.
        if (origin) reportFailure(origin);
        const delay = retry ? RETRY_DELAY_MS[attempt - 1] : undefined;
        if (delay === undefined) return;
        window.setTimeout(
          () => {
            // `load()` on an errored tile puts it back to IDLE with a fresh
            // image and re-enters this loader. The state check leaves alone a
            // tile something else has already reloaded.
            if (tile.getState() === TileState.ERROR) tile.load();
          },
          delay + Math.random() * RETRY_JITTER_MS,
        );
      },
      { once: true },
    );
    image.src = src;
  });
};

// Both maps: the split view's second pane draws out of the same upstreams.
const refreshSourcesFor = (origin: OriginId) => {
  for (const map of [getDefaultStore().get(mapAtom), peekSplitMap()]) {
    if (!map) continue;
    for (const layer of map.getLayers().getArray()) {
      if (!(layer instanceof Layer)) continue;
      const source = layer.getSource();
      if (source?.get(GUARD_PROP) === origin) source.refresh();
    }
  }
};

// Registered at module scope, so importing the guard is all a caller needs.
onOriginRecovered(refreshSourcesFor);
