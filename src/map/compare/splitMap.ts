import { getDefaultStore } from 'jotai';
import { defaults as defaultControls } from 'ol/control';
import { defaults as defaultInteractions } from 'ol/interaction';
import OlMap from 'ol/Map';
import { mapAtom } from '../atoms';

let splitMap: OlMap | null = null;

export const getSplitMap = (): OlMap => {
  if (splitMap) return splitMap;
  const main = getDefaultStore().get(mapAtom);
  splitMap = new OlMap({
    controls: defaultControls({ zoom: false, rotate: false }),
    interactions: defaultInteractions({
      altShiftDragRotate: false,
      pinchRotate: false,
      keyboard: false,
    }),
    maxTilesLoading: 48,
    view: main.getView(),
  });
  return splitMap;
};

export const peekSplitMap = (): OlMap | null => splitMap;
