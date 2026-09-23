import { atomEffect } from 'jotai-effect';
import { Feature } from 'ol';
import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import VectorLayer from 'ol/layer/Vector';
import { transformExtent } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Stroke, Style } from 'ol/style';
import { mapAtom } from '../map/atoms';
import { terrainAdjustingAtom, terrainWindowAtom } from './window';

// The frame of a standing analysis. `windowAdjust.ts` draws the same rectangle
// while it is being placed; only ever one of the two is up.
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
  // Over the render, which is at zIndex 1.
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
