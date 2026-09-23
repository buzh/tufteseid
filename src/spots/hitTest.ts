import type Map from 'ol/Map';

import type { SpotRecord } from '../api/spots';

export const SPOT_LAYER_ID = 'spotsLayer';
export const SPOT_RECORD_KEY = 'spotRecord';

const HIT_TOLERANCE = 6;

export const spotAtPixel = (
  map: Map,
  pixel: number[],
): SpotRecord | undefined =>
  map.forEachFeatureAtPixel(
    pixel,
    (feature) => feature.get(SPOT_RECORD_KEY) as SpotRecord | undefined,
    {
      hitTolerance: HIT_TOLERANCE,
      layerFilter: (layer) => layer.get('id') === SPOT_LAYER_ID,
    },
  );
