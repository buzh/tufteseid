// An origin is the set of requests that stop answering together, because one
// backend renders all of them — not a host and not an endpoint. Services not
// listed here get `tileGuard.ts`'s retry but no breaker and no probe.

import { getEnv } from '../env';

export type OriginId = 'hoyde' | 'kartverketCache' | 'ra' | 'nib';

/**
 * A one-metre box in Oslo, EPSG:25833, inside LiDAR, Kulturminner and ortofoto
 * coverage alike.
 */
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
  /**
   * The liveness check: a 1×1 GetMap or the coarsest WMTS tile, and one that
   * exercises the renderer — a HEAD or a GetCapabilities reads as up while the
   * backend behind the edge is dead. The WMS answers stay under the 300-byte
   * `$skip_cache` floor in `nginx/wms-cache.conf`, so they never enter the LRU.
   */
  probeUrl: string;
  /** Request prefixes the origin answers, matched against the URL. */
  prefixes: string[];
};

export const ORIGINS: Record<OriginId, Origin> = {
  // Kartverket's height services, hoydedata.no included: one backend, two
  // hostnames. The probe stays on the WMS namespace and off `/cache/lidar-dtm`,
  // where a MapProxy hit would report a dead service as up.
  hoyde: {
    probeUrl: wmsProbe(
      '/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833',
      'NHM_DTM_TOPOBATHY_25833:skyggerelieff',
    ),
    prefixes: [
      '/wms/geonorge/wms.hoyde-',
      '/wfs/geonorge/wfs.hoyde-',
      '/arcgis/hoydedata/',
      // The two live mosaics by name, not `/cache/lidar-`: that would also
      // match the source-less `-held` siblings `tileGuard.ts` redirects to.
      '/cache/lidar-dtm/',
      '/cache/lidar-dom/',
    ],
  },
  // Requested straight from the browser, not through wmscache.
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
    prefixes: ['/wms/nib/', '/arcgis/nib/', '/cache/flyfoto'],
  },
};

export const ORIGIN_IDS = Object.keys(ORIGINS) as OriginId[];

/** Which origin answers a URL, or null for one nothing here covers. */
export const originForUrl = (url: string): OriginId | null =>
  ORIGIN_IDS.find((id) =>
    ORIGINS[id].prefixes.some((prefix) => url.startsWith(prefix)),
  ) ?? null;
