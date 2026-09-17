import { getEnv } from '../../../../env';
import { BackgroundLayer, LayerProvider } from './types';

const env = getEnv();

const KvCacheProvider: LayerProvider = {
  capabilitiesUrl:
    env.layerProviderParameters.kartverketCache.baseUrl +
    '/v1/service?Request=GetCapabilities&Service=WMTS',
};

// One service, one capabilities document, one tile grid; only the drawing
// differs (vector, grey, scanned paper series, nautical chart). `layerName` is
// the WMTS identifier the cache is asked for, not a name of ours.
export const KvCacheBackgroundLayers: BackgroundLayer[] = [
  { type: 'WMTS', layerName: 'topo', provider: KvCacheProvider },
  { type: 'WMTS', layerName: 'topograatone', provider: KvCacheProvider },
  { type: 'WMTS', layerName: 'toporaster', provider: KvCacheProvider },
  { type: 'WMTS', layerName: 'sjokartraster', provider: KvCacheProvider },
];
