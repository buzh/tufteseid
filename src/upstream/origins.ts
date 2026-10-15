import { getEnv } from '../env';
import { serviceOn } from '../services';

export type OriginId = 'hoyde' | 'kartverketCache' | 'ra' | 'nib';

const PROBE_BBOX_25833 = '262000,6649000,262001,6649001';

const wmsProbe = (url: string, layers: string, format = 'image/png'): string =>
  `${url}?${new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: layers,
    STYLES: '',
    CRS: 'EPSG:25833',
    BBOX: PROBE_BBOX_25833,
    WIDTH: '1',
    HEIGHT: '1',
    FORMAT: format,
  })}`;

type Origin = {
  probeUrl: string;
  prefixes: string[];
};

export const NIB_PREFIXES = [
  '/wms/nib/',
  '/arcgis/nib/',
  '/cache/flyfoto',
] as const;

export const ORIGINS: Record<OriginId, Origin> = {
  hoyde: {
    probeUrl: wmsProbe(
      '/wms/geonorge/wms.hoyde-dtm-nhm-25833',
      'NHM_DTM_25833:skyggerelieff',
    ),
    prefixes: [
      '/wms/geonorge/wms.hoyde-',
      '/wfs/geonorge/wfs.hoyde-',
      '/arcgis/hoydedata/',
      '/cache/lidar-dtm/',
      '/cache/lidar-dom/',
    ],
  },
  kartverketCache: {
    probeUrl: `${getEnv().layerProviderParameters.kartverketCache.baseUrl}/v1/service?${new URLSearchParams(
      {
        service: 'WMTS',
        version: '1.0.0',
        request: 'GetTile',
        layer: 'topo',
        style: 'default',
        tilematrixset: 'utm33n',
        TileMatrix: '0',
        TileRow: '0',
        TileCol: '0',
        format: 'image/png',
      },
    )}`,
    prefixes: [getEnv().layerProviderParameters.kartverketCache.baseUrl],
  },
  ra: {
    probeUrl: wmsProbe('/wms/ra/kulturminner2', 'Kulturminner'),
    prefixes: ['/wms/ra/'],
  },
  nib: {
    probeUrl: wmsProbe('/wms/nib/ortofoto', 'ortofoto', 'image/jpeg'),
    prefixes: [...NIB_PREFIXES],
  },
};

export const ORIGIN_IDS = (Object.keys(ORIGINS) as OriginId[]).filter(
  (id) => id !== 'nib' || serviceOn('flyfoto'),
);

export const originForUrl = (url: string): OriginId | null =>
  ORIGIN_IDS.find((id) =>
    ORIGINS[id].prefixes.some((prefix) => url.startsWith(prefix)),
  ) ?? null;
