import { atomEffect } from 'jotai-effect';
import { Feature } from 'ol';
import { fromExtent as polygonFromExtent } from 'ol/geom/Polygon';
import VectorLayer from 'ol/layer/Vector';
import { transformExtent } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Stroke, Style } from 'ol/style';
import { mapAtom } from '../map/atoms';
import { mosaicTiles } from '../map/grid';
import { standingSpotFootprintAtom } from './atoms';
import { PIN_Z_INDEX } from './pinStyle';

// Solid on purpose, against the terrain window's dashed frame: the two say
// different things and must not be unified.
const CASING = 'rgba(255, 255, 255, 0.4)';
const FRAME = 'rgba(255, 106, 0, 0.7)';

const frameStyle = [
  new Style({ stroke: new Stroke({ color: CASING, width: 3 }) }),
  new Style({ stroke: new Stroke({ color: FRAME, width: 1 }) }),
];

// Thinner, so the render tiles read as a grid inside the boundary rather than
// competing with it.
const cellStyle = [new Style({ stroke: new Stroke({ color: FRAME, width: 0.5 }) })];

export const spotFootprintLayerEffect = atomEffect((get) => {
  const bbox = get(standingSpotFootprintAtom);
  if (!bbox) return;
  const map = get(mapAtom);

  const projection = map.getView().getProjection().getCode();
  const frame = new Feature({
    geometry: polygonFromExtent(transformExtent(bbox, 'EPSG:4326', projection)),
  });
  frame.set('frame', true);
  const tiles = mosaicTiles(bbox);
  const cells =
    tiles.length > 1
      ? tiles.map(
          (tile) =>
            new Feature({
              geometry: polygonFromExtent(
                transformExtent(tile, 'EPSG:4326', projection),
              ),
            }),
        )
      : [];
  const source = new VectorSource({
    wrapX: false,
    features: [...cells, frame],
  });
  // Just under the pin, so the pin it belongs to stays legible over it.
  const layer = new VectorLayer({
    zIndex: PIN_Z_INDEX - 1,
    source,
    style: (feature) => (feature.get('frame') ? frameStyle : cellStyle),
    properties: { id: 'spotFootprintLayer' },
  });
  map.addLayer(layer);

  return () => {
    map.removeLayer(layer);
    source.dispose();
  };
});
