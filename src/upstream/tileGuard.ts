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

const GUARD_PROP = 'upstreamOrigin';

const RETRY_DELAY_MS = [400, 900];
const RETRY_JITTER_MS = 300;

const attempts = new WeakMap<Tile, number>();

type GuardOptions = {
  retry?: boolean;
  heldUrl?: string;
};

const storePrefix = (template: string): string => {
  const cut = template.indexOf('{');
  return cut < 0 ? template : template.slice(0, cut);
};

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
        image.src = heldPrefix + src.slice(livePrefix.length);
        return;
      }
      tile.setState(TileState.ERROR);
      return;
    }
    const attempt = (attempts.get(tile) ?? 0) + 1;
    attempts.set(tile, attempt);

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
        if (origin) reportFailure(origin);
        const delay = retry ? RETRY_DELAY_MS[attempt - 1] : undefined;
        if (delay === undefined) return;
        window.setTimeout(
          () => {
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
