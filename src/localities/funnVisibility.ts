// Taking the funn off the map without unloading any of them — the whole group
// at once (the `Funn` label, key `H`) and one member at a time (its pulldown).
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
import { funnHiddenAtom, funnSwitchedOffAtom } from './atoms';
import { HIGHLIGHT_LAYER_ID } from './funnHighlightLayer';
import { FUNN_LAYER_ID, setSwitchedOffFunn } from './funnLayer';

// The funn and their halo, and nothing else. The lokalitet rectangles used to
// be in here too, back when this was one global "Skjul merker"; they came out
// when the switch moved onto `Funn`, because a control has to hide what the
// thing it sits on lists and nothing more. The rectangles answer the same
// complaint by drawing faint when they are not the open one — see
// localityLayer.ts.
//
// The *draw* layer is deliberately not here: you cannot draw a shape you
// cannot see, and starting a draft lifts the flag anyway (useLocalityWorkspace).
const FUNN_LAYER_IDS: readonly string[] = [FUNN_LAYER_ID, HIGHLIGHT_LAYER_ID];

/** Mount once, from useMapSideEffects, after the three layer hooks. */
export const useFunnVisibility = () => {
  const map = useAtomValue(mapAtom);
  const hidden = useAtomValue(funnHiddenAtom);
  const switchedOff = useAtomValue(funnSwitchedOffAtom);

  // One funn at a time is a *style*, not a layer: the funn are one vector
  // source, so there is nothing per-member to set `visible` on. Which is also
  // why the two halves of this file do not look alike — the group's switch
  // hides two layers, a member's empties one feature's style.
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

    // Also on `add`, not only when the flag changes: each layer is created by
    // its own hook and one arriving while the funn are hidden would default to
    // visible and put half of them back.
    const layers = map.getLayers();
    layers.on('add', apply);
    return () => {
      layers.un('add', apply);
    };
  }, [map, hidden]);
};
