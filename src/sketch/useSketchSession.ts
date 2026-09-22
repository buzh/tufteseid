// Owns the freeze. Mounted unconditionally by the spot surface and told
// whether the draft is in its draw stage; everything that has to be undone
// when it is not is in the effect's cleanup, so it runs whichever way the
// stage ends — the pen put down, the draft saved, the draft abandoned.
//
// Freeze first, then frame: `freezeMap` cancels any easing view animation too,
// so the extent read afterwards is one the map will still be showing. A draft
// that already has strokes keeps their frame instead of capturing a fresh one
// — capturing again would re-register old strokes to a new viewport — and is
// flown back to it first, with `bindFrameToMap` absorbing the difference
// between the rectangle asked for and the one `constrainResolution` lands on.

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

    // Read through the store rather than subscribed: the canvas writes this
    // atom on every settle, and a dependency on it here would tear the session
    // down and rebuild it mid-stroke.
    const resume = sketchOf(store.get(spotSketchAtom));
    const size = map.getSize();
    // No duration: the freeze below cancels animations, and a pen that waits
    // for a flight is a pen that can be pressed twice.
    if (resume && size) {
      view.fit(frameExtentIn(resume.frame, projection), { size });
    }

    freezeMap(map);
    const frame = resume?.frame ?? captureFrame(map);
    if (!frame) {
      // No size, so no scene↔ground mapping: better to stay out of the draw
      // stage than to hand over a canvas not registered to the ground.
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
