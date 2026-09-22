import { atomEffect } from 'jotai-effect';
import { Feature } from 'ol';
import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import VectorLayer from 'ol/layer/Vector';
import { transformExtent } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Stroke, Style } from 'ol/style';
import { mapAtom } from '../map/atoms';
import { terrainAdjustingAtom, terrainWindowAtom } from './window';

// The rectangle a standalone terrain analysis is reading, drawn so that
// "what am I analysing" has an answer after you have panned away from it —
// and when the answer is nothing, because the render itself is transparent
// wherever there is no laser coverage.
//
// Dashed and cased, thin and unnamed: nothing owns this rectangle and there is
// nothing to click on it. That is the difference from the one in
// `windowAdjust.ts`, which is the same rectangle while it is being placed and
// is drawn solid with corners on it because there it is a thing to take hold
// of. Only ever one of the two is up.
const CASING = 'rgba(255, 255, 255, 0.4)';
const FRAME = 'rgba(255, 106, 0, 0.55)';

const frameStyle = [
  new Style({
    stroke: new Stroke({ color: CASING, width: 3, lineDash: [6, 6] }),
  }),
  new Style({
    stroke: new Stroke({ color: FRAME, width: 1, lineDash: [6, 6] }),
  }),
];

export const terrainWindowLayerEffect = atomEffect((get) => {
  const bbox = get(terrainWindowAtom);
  if (!bbox || get(terrainAdjustingAtom)) return;
  // Built once at module eval and never replaced, so reading it here does not
  // make this effect re-run.
  const map = get(mapAtom);

  const projection = map.getView().getProjection().getCode();
  const source = new VectorSource({
    wrapX: false,
    features: [
      new Feature({
        geometry: polygonFromExtent(
          transformExtent(bbox, 'EPSG:4326', projection),
        ),
      }),
    ],
  });
  // Above the background and whatever the render itself lands on.
  const layer = new VectorLayer({
    zIndex: 4,
    source,
    style: frameStyle,
    properties: { id: 'terrainWindowLayer' },
  });
  map.addLayer(layer);

  return () => {
    map.removeLayer(layer);
    source.dispose();
  };
});
