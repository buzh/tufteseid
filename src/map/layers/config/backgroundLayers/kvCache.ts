import { getEnv } from '../../../../env';
import { BackgroundLayer, LayerProvider } from './types';

const env = getEnv();

const KvCacheProvider: LayerProvider = {
  capabilitiesUrl:
    env.layerProviderParameters.kartverketCache.baseUrl +
    '/v1/service?Request=GetCapabilities&Service=WMTS',
};

// Every finished cartography the cache publishes, and all four are Standard
// variants (src/.../standardVariants.ts). They are one service, one
// capabilities document and one tile grid — the only thing that differs is
// the drawing:
//
// - topo          the ordinary vector-drawn topographic map
// - topograatone  the same, in grey, i.e. the one to put coloured marks on
// - toporaster    the printed paper series' own cartography, scanned
// - sjokartraster the nautical chart: depths, soundings, skerries
//
// `layerName` is the WMTS identifier the cache is asked for, so these strings
// are the service's vocabulary rather than ours.
export const KvCacheBackgroundLayers: BackgroundLayer[] = [
  { type: 'WMTS', layerName: 'topo', provider: KvCacheProvider },
  { type: 'WMTS', layerName: 'topograatone', provider: KvCacheProvider },
  { type: 'WMTS', layerName: 'toporaster', provider: KvCacheProvider },
  { type: 'WMTS', layerName: 'sjokartraster', provider: KvCacheProvider },
];
