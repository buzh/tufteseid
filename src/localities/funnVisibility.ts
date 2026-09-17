// Taking the funn off the map without unloading them: the whole group (the
// `Funn` label, key `H`) or one member at a time. `setVisible(false)` rather
// than removing the layers, because the hydrated features, two realtime
// subscriptions, the halo and the draw layer's state all hang off them.

import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { mapAtom } from '../map/atoms';
import { funnHiddenAtom, funnSwitchedOffAtom } from './atoms';
import { HIGHLIGHT_LAYER_ID } from './funnHighlightLayer';
import { FUNN_LAYER_ID, setSwitchedOffFunn } from './funnLayer';

// The funn and their halo, and nothing else. Not the draw layer: you cannot
// draw a shape you cannot see, and starting a draft lifts the flag anyway.
const FUNN_LAYER_IDS: readonly string[] = [FUNN_LAYER_ID, HIGHLIGHT_LAYER_ID];

/** Mount once, from useMapSideEffects, after the three layer hooks. */
export const useFunnVisibility = () => {
  const map = useAtomValue(mapAtom);
  const hidden = useAtomValue(funnHiddenAtom);
  const switchedOff = useAtomValue(funnSwitchedOffAtom);

  // One funn at a time is a style, not a layer: they share one vector source,
  // so there is nothing per-member to set `visible` on.
  useEffect(() => {
    setSwitchedOffFunn(switchedOff);
  }, [switchedOff]);

  useEffect(() => {
    const apply = () => {
      for (const layer of map.getLayers().getArray()) {
        if (FUNN_LAYER_IDS.includes(String(layer.get('id') ?? ''))) {
          layer.setVisible(!hidden);
        }
      }
    };
    apply();

    // Also on `add`: a layer created by its own hook while the funn are hidden
    // would arrive visible.
    const layers = map.getLayers();
    layers.on('add', apply);
    return () => {
      layers.un('add', apply);
    };
  }, [map, hidden]);
};
