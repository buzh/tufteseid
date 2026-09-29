import type { Feature } from 'ol';
import type { FeatureLike } from 'ol/Feature';
import type Map from 'ol/Map';

import type { SpotRecord } from '../api/spots';

export const SPOT_LAYER_ID = 'spotsLayer';
export const SPOT_RECORD_KEY = 'spotRecord';

/** `ol/source/Cluster`'s own name for the features it gathered. */
const CLUSTER_KEY = 'features';

/** The records behind a cluster feature — one of them for a lone pin. */
export const clusterRecords = (feature: FeatureLike): SpotRecord[] =>
  ((feature.get(CLUSTER_KEY) ?? []) as Feature[]).map(
    (member) => member.get(SPOT_RECORD_KEY) as SpotRecord,
  );

const HIT_TOLERANCE = 6;

/** What a pixel takes hold of: the one record under a pin, or every record a
 *  gathering stands for. Undefined when the pixel is on neither. */
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
