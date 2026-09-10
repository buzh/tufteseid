// "Skjul markeringer": take our own marks off the map without unloading any
// of them.
//
// `setVisible(false)` rather than removing the layers, because everything the
// glance is meant to leave alone hangs off them — the hydrated features, two
// PocketBase realtime subscriptions, the selection and hover halo, and the
// draw layer's idea of which funn it is holding. This is a way of *looking*,
// not a mode with state of its own, so nothing here writes to the record and
// nothing survives a reload.

import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { mapAtom } from '../map/atoms';
import { marksHiddenAtom } from './atoms';
import { HIGHLIGHT_LAYER_ID } from './funnHighlightLayer';
import { FUNN_LAYER_ID } from './funnLayer';
import { LOCALITIES_LAYER_ID } from './localityLayer';

// The rectangles go with the funn. They are a thin cased frame now rather
// than the old orange wash, but the corner brackets still land on ground, and
// one press that clears everything authored beats two that each clear half.
//
// The *draw* layer is deliberately not here: you cannot draw a shape you
// cannot see, and starting a draft lifts the flag anyway (useLocalityWorkspace).
const MARK_LAYER_IDS: readonly string[] = [
  LOCALITIES_LAYER_ID,
  FUNN_LAYER_ID,
  HIGHLIGHT_LAYER_ID,
];

/** Mount once, from useMapSideEffects, after the three layer hooks. */
export const useMarksVisibility = () => {
  const map = useAtomValue(mapAtom);
  const hidden = useAtomValue(marksHiddenAtom);

  useEffect(() => {
    const apply = () => {
      for (const layer of map.getLayers().getArray()) {
        if (MARK_LAYER_IDS.includes(String(layer.get('id') ?? ''))) {
          layer.setVisible(!hidden);
        }
      }
    };
    apply();

    // Also on `add`, not only when the flag changes: each of the three layers
    // is created by its own hook and a layer arriving while marks are hidden
    // would default to visible and put half the marks back.
    const layers = map.getLayers();
    layers.on('add', apply);
    return () => {
      layers.un('add', apply);
    };
  }, [map, hidden]);
};
