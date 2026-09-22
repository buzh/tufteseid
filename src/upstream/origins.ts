// The external services the map reads from, grouped by what fails together.
//
// An origin is not a host and not an endpoint: it is the set of requests that
// stop answering at the same moment, because one backend renders all of them.
// Kartverket publishes the national LiDAR mosaic, the per-project flights, the
// acquisition footprints and the float DEM across three URL namespaces and two
// hostnames, but one høydedata backend is behind the lot — the outage of
// 2026-09-21 took the GetMap, the GetCapabilities and the WFS down together and
// left the neighbouring `wms.topograatone` answering in 190 ms. So they are one
// row here, and one breaker at runtime.
//
// The same evidence is why the Hybrid overlay and the Amtskart ground — now
// `/cache/topo-ref*` and `/cache/amtskart`, wms.topo and wms.historiskekart
// underneath — are in no row at all, even though they share a hostname with the
// height services. They are a different renderer, they stayed up through that
// outage, and they are each one layer on one surface: an outage of theirs is a
// blank overlay, not a blank map. The Kulturminnesøk record API behind `/kms/`
// is left out for the same reason. Being in no row costs them the breaker and
// the probe, not the retry — `tileGuard.ts` gives that to every source, which
// is what keeps a dropped request from being permanent here of all places.
//
// The `/cache/` prefixes that *are* listed below are MapProxy's, and a hit
// there answers off disk with no upstream involved. Refusing a hit throws away
// a tile we own; letting a miss through holds a worker for the source's 60 s
// `client_timeout`, and a screenful of those wedges MapProxy's pool for every
// layer, including the ones whose upstream is healthy. The two LiDAR mosaics
// take neither horn: each has a read-only sibling in `mapproxy.yaml` —
// `lidar-dtm-held`, `lidar-dom-held` — over the same MBTiles file with no
// source behind it, and `tileGuard.ts` redirects to it while this breaker is
// open. Stored tiles keep drawing, a miss is a transparent tile rather than a
// stalled worker, and nothing reaches upstream either way. That is why the two
// exact prefixes are listed below and not `/cache/lidar-`, which would have
// matched the siblings and refused them too. `/cache/flyfoto` has no sibling
// and is still refused outright: better a blank ground, and the ribbon saying
// so, than half a map that claims to be up.

import { getEnv } from '../env';

export type OriginId = 'hoyde' | 'kartverketCache' | 'ra' | 'nib';

/**
 * A one-metre box in Oslo, EPSG:25833. Inside LiDAR, Kulturminner and ortofoto
 * coverage alike, so one constant serves every probe. What it contains does not
 * matter — a no-data render is as good an answer as a hillshade, since the
 * question is whether anything answers at all.
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
   * The liveness check. Two properties, both deliberate.
   *
   * **Small.** Every one is a 1×1 GetMap or the coarsest WMTS tile, so a probe
   * is tens of bytes and costs the origin a render it does in microseconds.
   * The WMS ones come back under 300 bytes, which is also what keeps them out
   * of the disk cache: `$skip_cache` in `nginx/wms-cache.conf` drops anything
   * too small to be a map, so a probe neither fills the LRU nor answers itself
   * out of it on the next pass. That is belt and braces with the cache-buster
   * `probeUrl()` puts on these in `health.ts`; a served-stale probe would be
   * the one failure this whole mechanism cannot recover from. The WMTS one is
   * 5.7 kB and goes direct to cache.kartverket.no rather than through
   * wmscache, so `no-store` on the request is what keeps *that* one honest.
   *
   * **Real.** A HEAD against the host, or a GetCapabilities, would have said
   * "up" right through the outage this was written for: the edge was
   * answering, the renderer behind it was not.
   */
  probeUrl: string;
  /**
   * Request prefixes the origin answers. Matched against the URL at
   * layer-build and fetch time rather than declared on each layer config —
   * one table then covers the background grounds, the Kulturminner themes,
   * the two catalogue fetches and the footprint WFS without threading an id
   * through five unrelated config shapes.
   */
  prefixes: string[];
};

export const ORIGINS: Record<OriginId, Origin> = {
  // Kartverket's height services. `/arcgis/hoydedata/` is the float DEM behind
  // src/terrain — a different hostname (hoydedata.no) that went down in the
  // same hour, which is the whole argument for one row rather than two. The
  // probe stays on the WMS namespace and not on `/cache/lidar-dtm`: a MapProxy
  // tile can be a hit, and a hit would report a dead service as up.
  hoyde: {
    probeUrl: wmsProbe(
      '/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833',
      'NHM_DTM_TOPOBATHY_25833:skyggerelieff',
    ),
    prefixes: [
      '/wms/geonorge/wms.hoyde-',
      '/wfs/geonorge/wfs.hoyde-',
      '/arcgis/hoydedata/',
      // The two live mosaics by name. Not `/cache/lidar-`: that also spells
      // `/cache/lidar-dtm-held/`, and the held siblings are the way out.
      '/cache/lidar-dtm/',
      '/cache/lidar-dom/',
    ],
  },
  // The pre-rendered base under every ground. Straight from the browser, not
  // through wmscache, so a failure here is Kartverket's CDN rather than ours.
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

/**
 * Which origin answers a URL, or null for one nothing here covers — our own
 * cVAT tile store, PocketBase, the place-name API. Those get no breaker,
 * because a breaker is only worth its complexity in front of a service that
 * fails slowly and in bulk.
 */
export const originForUrl = (url: string): OriginId | null =>
  ORIGIN_IDS.find((id) =>
    ORIGINS[id].prefixes.some((prefix) => url.startsWith(prefix)),
  ) ?? null;
