import type { Feature } from 'ol';
import type { FeatureLike } from 'ol/Feature';
import type Map from 'ol/Map';

import type { SpotRecord } from '../api/spots';

export const SPOT_LAYER_ID = 'spotsLayer';
export const SPOT_RECORD_KEY = 'spotRecord';

const CLUSTER_KEY = 'features';

export const clusterRecords = (feature: FeatureLike): SpotRecord[] =>
  ((feature.get(CLUSTER_KEY) ?? []) as Feature[]).map(
    (member) => member.get(SPOT_RECORD_KEY) as SpotRecord,
  );

const HIT_TOLERANCE = 6;

export const spotsAtPixel = (
  map: Map,
  pixel: number[],
): SpotRecord[] | undefined =>
  map.forEachFeatureAtPixel(
    pixel,
    (feature) => {
      const records = clusterRecords(feature);
      return records.length > 0 ? records : undefined;
    },
    {
      hitTolerance: HIT_TOLERANCE,
      layerFilter: (layer) => layer.get('id') === SPOT_LAYER_ID,
    },
  );
