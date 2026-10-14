import { useAtomValue, useStore } from 'jotai';
import { intersects, type Extent } from 'ol/extent';
import type Map from 'ol/Map';
import { transformExtent } from 'ol/proj';
import type { Size } from 'ol/size';
import { useEffect } from 'react';

import { draftGroundAtom, draftGroundExtent } from '../evidence/draftGround';
import { mapAtom } from '../map/atoms';
import {
  setSpotStageAtom,
  spotFootprintAtom,
  spotSketchAtom,
} from '../spots/atoms';
import {
  captureFrame,
  footprintFrame,
  frameExtentIn,
  type SketchFrame,
} from './frame';
import { reframeScene, sketchOf } from './scene';
import {
  bindFrameToMap,
  freezeMap,
  nextSessionId,
  sketchSessionAtom,
  thawMap,
} from './session';

const MIN_SCENE_ZOOM = 0.1;

const MAX_SCENE_ZOOM = 30;

const FIT_PADDING_PX = 48;

const fitIfOutOfReach = (
  map: Map,
  frame: SketchFrame,
  target: Extent,
  size: Size,
) => {
  const view = map.getView();
  const resolution = view.getResolution();
  if (!resolution) return;
  const extent = frameExtentIn(frame, view.getProjection().getCode());
  const zoom = (extent[2] - extent[0]) / frame.widthPx / resolution;
  if (
    zoom >= MIN_SCENE_ZOOM &&
    zoom <= MAX_SCENE_ZOOM &&
    intersects(target, view.calculateExtent(size))
  ) {
    return;
  }
  view.fit(target, {
    size,
    padding: [FIT_PADDING_PX, FIT_PADDING_PX, FIT_PADDING_PX, FIT_PADDING_PX],
  });
};

export const useSketchSession = (wanted: boolean) => {
  const map = useAtomValue(mapAtom);
  const store = useStore();

  useEffect(() => {
    if (!wanted) return;
    const view = map.getView();
    const projection = view.getProjection().getCode();

    const resume = sketchOf(store.get(spotSketchAtom));
    const footprint = store.get(spotFootprintAtom);
    const ground = store.get(draftGroundAtom);
    const size = map.getSize();
    const groundExtent = ground ? draftGroundExtent(ground) : null;
    const over = footprint ? footprintFrame(map, footprint) : null;

    if (over && size) {
      fitIfOutOfReach(
        map,
        over,
        groundExtent
          ? transformExtent(groundExtent, 'EPSG:25833', projection)
          : frameExtentIn(over, projection),
        size,
      );
    } else if (resume && size) {
      view.fit(frameExtentIn(resume.frame, projection), { size });
    } else if (groundExtent && size) {
      view.fit(transformExtent(groundExtent, 'EPSG:25833', projection), {
        size,
      });
    }

    freezeMap(map);
    const frame = over ?? resume?.frame ?? captureFrame(map);
    if (!frame) {
      thawMap(map);
      store.set(setSpotStageAtom, 'idle');
      return;
    }

    bindFrameToMap(map, frame, frameExtentIn(frame, projection));
    store.set(sketchSessionAtom, {
      id: nextSessionId(),
      frame,
      opening: resume ? reframeScene(resume, frame) : [],
    });

    return () => {
      thawMap(map);
      store.set(sketchSessionAtom, null);
    };
  }, [wanted, map, store]);
};
