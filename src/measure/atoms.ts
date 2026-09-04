import { atom } from 'jotai';
import { atomEffect } from 'jotai-effect';
import { getMeasureLayer } from '../draw/drawControls/hooks/mapLayers';
import { mapAtom } from '../map/atoms';

import { removeOwnedInteractions } from '../map/interactions';
import { mapToolAtom } from '../map/overlay/atoms';
import { addMeasureInteractionToMap } from './measureInteractions';

export type MeasureType = 'length' | 'area' | null;

export const measureTypeAtom = atom<MeasureType>(null);

export const measureEnabledEffect = atomEffect((get) => {
  const type = get(measureTypeAtom);
  const tool = get(mapToolAtom);
  const map = get(mapAtom);
  const layer = getMeasureLayer();

  if (tool !== 'measure') {
    layer.getSource()?.clear();
    removeOwnedInteractions(map, 'measure');
    return;
  }
  setTimeout(() => {
    addMeasureInteractionToMap(
      type === 'length' ? 'LineString' : 'Polygon',
      layer,
      map,
    );
  });
});
