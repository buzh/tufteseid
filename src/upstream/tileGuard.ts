// The breaker and the retry, applied to a tile source.
//
// Both halves of the breaker's loop live in one place, and they have to:
// admission and reporting must agree about which requests are real. Reading
// failures off the source's `tileloaderror` event instead would count the tiles
// this file refused, and an origin that was merely quiet would be held down by
// the evidence of its own being held down.
//
// The retry is here for a different reason. OpenLayers asks for a tile once: a
// dropped request leaves the tile ERROR and nothing re-asks, so one 502 in a
// pan is a hole that stays until the page is reloaded. The rate is low —
// roughly one in 250 against the per-project LiDAR namespace — but a hole is
// per level and per tile, so what a reader sees is a map that mostly works with
// patches missing at the zoom they happened to be at. Two retries on a short
// jittered backoff close that, and cost nothing when nothing is failing.
//
// There is nothing to close where a missing tile is the answer. An `<img>`
// error carries no status, so a 404 that means "nobody wrote a tile here" reads
// exactly like a 502 that means "ask again" — and a sparse store asked three
// times returns the mask three times. Hence `retry: false`, which the cVAT
// ground passes and nothing else does.
//
// The third option, `heldUrl`, is for a layer that has somewhere to go while
// the breaker is open. Refusing is the right default — a refused request is one
// the origin does not have to survive — but the two national LiDAR mosaics are
// served out of MapProxy, and most of what the reader is looking at is already
// on our disk. So they name a read-only sibling store, and a tile asked for
// during an outage is rewritten to it rather than dropped. See `origins.ts`.

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
 * Gap before each retry, before jitter. Its length is the retry count — a tile
 * is tried once, then once more per entry here — so there is one number to
 * change and nothing to keep in step with it.
 */
const RETRY_DELAY_MS = [400, 900];
/** Up to this much again, so a failed screenful does not retry in lockstep. */
const RETRY_JITTER_MS = 300;

/**
 * Tries spent on a tile so far. Keyed by the tile because `load()` re-enters
 * the loader below with the same tile and a fresh image, and weak because the
 * source disposes its tiles on `refresh()` and `clear()` — a reloaded tile is a
 * new object and starts over, which is what should happen.
 */
const attempts = new WeakMap<Tile, number>();

type GuardOptions = {
  /**
   * Whether a request that produced no picture is worth making again. Off for
   * a sparse store — see the header, and `sparse` in the layer config.
   */
  retry?: boolean;
  /**
   * A store with the same tiles in it and nothing upstream behind it, as a
   * template differing from `url` only in the part that names the store. Given
   * one, a tile asked for while the breaker is open goes there instead of
   * failing.
   */
  heldUrl?: string;
};

/** Everything in a tile template before the first placeholder: the part that
 *  names the store, which is the only part a held sibling changes. */
const storePrefix = (template: string): string => {
  const cut = template.indexOf('{');
  return cut < 0 ? template : template.slice(0, cut);
};

/**
 * Put `source` behind the retry, and behind the breaker for whichever origin
 * `url` belongs to.
 *
 * The retry wants no origin of its own: `/cache/topo-ref*` and
 * `/cache/amtskart` are in no row on purpose (`origins.ts`), and that reasoning
 * is about whether to *stop asking* during an outage. It says nothing about a
 * single dropped request, and those two are the layers with the least recourse
 * — with no origin there is no probe and no `refresh()`, so without this a hole
 * in them is permanent. What it does want is a source where a failed request is
 * the only reason a tile can fail to arrive.
 *
 * Called by the four background builders and by the theme builder, with the
 * URL each of them already has in hand.
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
        // Neither reported nor counted as an attempt: nothing upstream is
        // being asked, so this can neither trip the breaker nor be what
        // recovers it. Not retried either — a tile the store does not hold is
        // a blank, and asking twice blanks twice. `refresh()` below puts the
        // layer back on the live store once the probe succeeds.
        image.src = heldPrefix + src.slice(livePrefix.length);
        return;
      }
      // Not a deferral: OpenLayers keeps no queue of its own for this, and a
      // tile left LOADING would hold one of the sixteen slots the whole map
      // shares. ERROR frees the slot and is undone by `refresh()` below.
      //
      // Not counted as an attempt either, and not retried: while the breaker is
      // open the answer would be the same, and the way back is the probe.
      tile.setState(TileState.ERROR);
      return;
    }
    const attempt = (attempts.get(tile) ?? 0) + 1;
    attempts.set(tile, attempt);

    // Ours are additional to the ones OpenLayers attaches after this returns;
    // it still drives the tile's own state.
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
        // Every try that failed is reported, not just the last one, so the
        // breaker still counts requests that produced no picture and trips on
        // the third — sooner in tiles than before, because one tile can now
        // spend three. Which is the right way round: retrying is what we stop
        // doing once the origin is known to be down.
        if (origin) reportFailure(origin);
        const delay = retry ? RETRY_DELAY_MS[attempt - 1] : undefined;
        if (delay === undefined) return;
        window.setTimeout(
          () => {
            // OpenLayers has marked the tile ERROR by now; `load()` on an
            // errored tile puts it back to IDLE with a fresh image and calls
            // straight back in here. Checking the state first is also how a
            // tile that something else has already reloaded — a `refresh()`
            // landing mid-backoff — is left alone.
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

// Walked rather than kept in a registry of our own: a map's collection is by
// definition the set of sources that can still put something on screen, and a
// swapped-out ground should neither be refreshed nor kept alive by us. Both
// maps, because the split view's second pane draws its ground out of the same
// upstreams and a recovery that reached only the left half would leave the
// right one holding the blank tiles of an outage that is over.
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

// Module scope, so importing the guard is all a caller has to do. There is one
// breaker set, so there is one listener.
onOriginRecovered(refreshSourcesFor);
