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
  SHED_STATUS,
} from './health';
import { originForUrl, type OriginId } from './origins';

const GUARD_PROP = 'upstreamOrigin';

const RETRY_DELAY_MS = [400, 900];
const RETRY_JITTER_MS = 300;
const SHED_DELAY_MS = [1500, 3500, 7000];

const failures = new WeakMap<Tile, number>();
const sheds = new WeakMap<Tile, number>();

type Verdict = 'hole' | 'shed' | 'fail';

const verdictFor = (status: number): Verdict => {
  if (status === SHED_STATUS) return 'shed';
  if (status === 408) return 'fail';
  if (status >= 400 && status < 500) return 'hole';
  return 'fail';
};

type GuardOptions = {
  heldUrl?: string;
};

const storePrefix = (template: string): string => {
  const cut = template.indexOf('{');
  return cut < 0 ? template : template.slice(0, cut);
};

const bump = (counts: WeakMap<Tile, number>, tile: Tile): number => {
  const next = (counts.get(tile) ?? 0) + 1;
  counts.set(tile, next);
  return next;
};

const retryAfter = (tile: Tile, delay: number) => {
  window.setTimeout(() => {
    if (tile.getState() === TileState.ERROR) tile.load();
  }, delay);
};

export const guardTileSource = (
  source: TileImage,
  url: string,
  { heldUrl }: GuardOptions = {},
): void => {
  const origin = originForUrl(url);
  if (origin) source.set(GUARD_PROP, origin);

  const livePrefix = storePrefix(url);
  const heldPrefix = heldUrl ? storePrefix(heldUrl) : null;

  const settle = (tile: Tile, status: number) => {
    const verdict = verdictFor(status);
    tile.setState(TileState.ERROR);

    if (verdict === 'hole') {
      if (origin) reportSuccess(origin);
      return;
    }
    if (verdict === 'shed') {
      const base = SHED_DELAY_MS[bump(sheds, tile) - 1];
      if (base !== undefined) retryAfter(tile, base * (1 + Math.random()));
      return;
    }
    if (origin) reportFailure(origin);
    const base = RETRY_DELAY_MS[bump(failures, tile) - 1];
    if (base !== undefined) {
      retryAfter(tile, base + Math.random() * RETRY_JITTER_MS);
    }
  };

  source.setTileLoadFunction(async (tile, src) => {
    const image = (tile as ImageTile).getImage() as HTMLImageElement;

    if (origin && !mayRequest(origin)) {
      if (heldPrefix !== null && src.startsWith(livePrefix)) {
        image.src = heldPrefix + src.slice(livePrefix.length);
        return;
      }
      tile.setState(TileState.ERROR);
      return;
    }

    let status = 0;
    let body: Blob | null = null;
    try {
      const res = await fetch(src);
      status = res.status;
      if (res.ok) body = await res.blob();
    } catch {
      status = 0;
    }

    if (tile.getState() !== TileState.LOADING) return;
    if (!body) {
      settle(tile, status);
      return;
    }

    const objectUrl = URL.createObjectURL(body);
    image.addEventListener(
      'load',
      () => {
        URL.revokeObjectURL(objectUrl);
        failures.delete(tile);
        sheds.delete(tile);
        if (origin) reportSuccess(origin);
      },
      { once: true },
    );
    image.addEventListener(
      'error',
      () => {
        URL.revokeObjectURL(objectUrl);
        settle(tile, 0);
      },
      { once: true },
    );
    image.src = objectUrl;
  });
};

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

onOriginRecovered(refreshSourcesFor);
