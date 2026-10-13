

import { useAtomValue, useStore } from 'jotai';
import { transformExtent } from 'ol/proj';
import { useEffect } from 'react';

import { draftGroundAtom } from '../evidence/draftGround';
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

    const resume = sketchOf(store.get(spotSketchAtom));
    const ground = store.get(draftGroundAtom);
    const size = map.getSize();

    if (resume && size) {
      view.fit(frameExtentIn(resume.frame, projection), { size });
    } else if (ground && size) {

      view.fit(transformExtent(ground.extent, 'EPSG:25833', projection), {
        size,
      });
    }

    freezeMap(map);
    const frame = resume?.frame ?? captureFrame(map);
    if (!frame) {

      thawMap(map);
      store.set(setSpotStageAtom, 'idle');
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
