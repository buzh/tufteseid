// Freeze first, then frame: `freezeMap` also cancels an easing view animation,
// so the extent read afterwards is one the map will still show. A draft that
// already has strokes keeps their frame and is flown back to it first;
// `bindFrameToMap` absorbs the difference between the rectangle asked for and
// the one `constrainResolution` lands on.

import { useAtomValue, useStore } from 'jotai';
import { useEffect } from 'react';

import { mapAtom } from '../map/atoms';
import { setSpotStageAtom, spotSketchAtom } from '../spots/atoms';
import { captureFrame, frameExtentIn } from './frame';
import { sketchOf } from './scene';
import {
  bindFrameToMap,
  freezeMap,
  nextSessionId,
  sketchSessionAtom,
  thawMap,
} from './session';

export const useSketchSession = (wanted: boolean) => {
  const map = useAtomValue(mapAtom);
  const store = useStore();

  useEffect(() => {
    if (!wanted) return;
    const view = map.getView();
    const projection = view.getProjection().getCode();

    // Read through the store, not subscribed: the canvas writes this atom on
    // every settle, and a dependency would rebuild the session mid-stroke.
    const resume = sketchOf(store.get(spotSketchAtom));
    const size = map.getSize();
    // No duration: the freeze below cancels animations.
    if (resume && size) {
      view.fit(frameExtentIn(resume.frame, projection), { size });
    }

    freezeMap(map);
    const frame = resume?.frame ?? captureFrame(map);
    if (!frame) {
      // No size, so no scene↔ground mapping; stay out of the draw stage.
      thawMap(map);
      store.set(setSpotStageAtom, 'pin');
      return;
    }

    bindFrameToMap(map, frame, frameExtentIn(frame, projection));
    store.set(sketchSessionAtom, {
      id: nextSessionId(),
      frame,
      opening: resume?.elements ?? [],
    });

    return () => {
      thawMap(map);
      store.set(sketchSessionAtom, null);
    };
  }, [wanted, map, store]);
};
