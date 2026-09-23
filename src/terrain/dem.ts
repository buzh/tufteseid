import { transformExtent } from 'ol/proj';
import { planTiles, runWithConcurrency } from '../lidarExtract/stitch';
import { MAX_SIDE_M, type Bbox } from '../map/bbox';
import { fetchWithin } from '../shared/utils/deadline';
import { isUpstreamDown } from '../upstream/health';

const IMAGE_SERVER_BASE = '/arcgis/hoydedata';

// dtm = bare earth, dom = first return (canopy and buildings).
export type DemModel = 'dtm' | 'dom';

// Per-acquisition mosaics, not the national NHM_* ones: where NHM never flew
// the national catalogue silently serves 10 m contour-derived rows upsampled,
// while the per-project ones report no coverage.
const SERVICE: Record<DemModel, string> = {
  dtm: 'Prosjekt_DTM',
  dom: 'Prosjekt_DOM',
};

// Finest acquisition wins where they overlap. Stated explicitly because
// Prosjekt_DOM defaults to a Northwest mosaic method and Prosjekt_DTM does not.
const MOSAIC_RULE = JSON.stringify({
  mosaicMethod: 'esriMosaicAttribute',
  sortField: 'lowps',
  sortValue: 0,
});

// Finest resolution the per-project services publish; acquisitions are 0.25,
// 0.5 or 1 m.
const FINEST_M_PER_PX = 0.25;

// Ground fetched outside the rectangle on every side and cropped off before
// painting, so horizon rays near the edge do not walk off the grid. 24 m is the
// longest reach any view can ask for (`horizonMaxRadiusMetres`).
export const DEM_MARGIN_M = 24;

const MAX_DEM_PX_PER_SIDE = (MAX_SIDE_M + 2 * DEM_MARGIN_M) / FINEST_M_PER_PX;

const MAX_CONCURRENT = 3;
const TILE_RETRIES = 3;
const CATALOGUE_TIMEOUT_MS = 20_000;
const TILE_TIMEOUT_MS = 60_000;

export type Dem = {
  // The assembled grid, margin included.
  width: number;
  height: number;
  // Row-major, north-up (row 0 is the northern edge), metres above the vertical
  // datum; NaN marks no coverage.
  data: Float32Array;
  // The rectangle that was asked for.
  bbox25833: [number, number, number, number];
  // `bbox25833` grown by DEM_MARGIN_M — what `width × height` spans.
  grid25833: [number, number, number, number];
  // Where `bbox25833` sits inside the grid, in pixels.
  window: { x: number; y: number; width: number; height: number };
  metresPerPx: number;
  // What the finest covering acquisition publishes: equal to metresPerPx unless
  // the grid exceeded MAX_DEM_PX_PER_SIDE and was sampled down.
  nativeMetresPerPx: number;
  model: DemModel;
};

function buildUrl(
  model: DemModel,
  bbox25833: [number, number, number, number],
  widthPx: number,
  heightPx: number,
): string {
  const params = new URLSearchParams({
    f: 'image',
    bbox: bbox25833.join(','),
    bboxSR: '25833',
    imageSR: '25833',
    size: `${widthPx},${heightPx}`,
    format: 'tiff',
    pixelType: 'F32',
    interpolation: 'RSP_BilinearInterpolation',
    // rasterFunction 'None' returns values; the service's other function,
    // `skyggerelieff`, returns a shaded image.
    renderingRule: JSON.stringify({ rasterFunction: 'None' }),
    mosaicRule: MOSAIC_RULE,
  });
  return `${IMAGE_SERVER_BASE}/${SERVICE[model]}/ImageServer/exportImage?${params.toString()}`;
}

// 'none' is the catalogue answering that nothing covers this; 'unknown' is the
// probe itself failing, which must not be reported as an absence.
type Coverage = { metresPerPx: number } | 'none' | 'unknown';

// wmscache declines to store responses under 1000 bytes and this one is far
// under, so memoise in-tab.
const coverageCache = new Map<string, Promise<Coverage>>();

// Finest OPPLOSNING among the acquisitions intersecting the rectangle, read off
// the envelope: one clipping a corner sets the target for the whole grid.
function probeCoverage(
  model: DemModel,
  bbox25833: [number, number, number, number],
  signal?: AbortSignal,
): Promise<Coverage> {
  const key = `${model}|${bbox25833.map((v) => Math.round(v)).join(',')}`;
  const hit = coverageCache.get(key);
  if (hit) return hit;

  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({
      xmin: bbox25833[0],
      ymin: bbox25833[1],
      xmax: bbox25833[2],
      ymax: bbox25833[3],
      spatialReference: { wkid: 25833 },
    }),
    geometryType: 'esriGeometryEnvelope',
    inSR: '25833',
    spatialRel: 'esriSpatialRelIntersects',
    // The 10 m fallback rows have no OPPLOSNING, so excluding them makes a null
    // answer mean "no laser data".
    where: 'OPPLOSNING IS NOT NULL',
    outStatistics: JSON.stringify([
      {
        statisticType: 'min',
        onStatisticField: 'OPPLOSNING',
        outStatisticFieldName: 'best',
      },
    ]),
    returnGeometry: 'false',
  });
  const url = `${IMAGE_SERVER_BASE}/${SERVICE[model]}/ImageServer/query?${params.toString()}`;

  const pending = (async (): Promise<Coverage> => {
    const body = await fetchWithin(
      url,
      { ms: CATALOGUE_TIMEOUT_MS, what: 'DEM catalogue query', signal },
      (res) => res.json(),
    );
    if (body?.error) throw new Error('catalogue query rejected');
    // The service upper-cases outStatisticFieldName, and no coverage arrives as
    // one feature with a null statistic, not an empty features array.
    const attrs = body?.features?.[0]?.attributes;
    const best = attrs ? (attrs.BEST ?? attrs.best) : null;
    if (typeof best !== 'number' || !(best > 0)) return 'none';
    return { metresPerPx: best };
  })();

  const guarded = pending.catch((): Coverage => {
    coverageCache.delete(key);
    return 'unknown';
  });
  coverageCache.set(key, guarded);
  return guarded;
}

export type FetchDemOptions = {
  model?: DemModel;
  signal?: AbortSignal;
};

// Null when the bbox is entirely outside LiDAR coverage; throws when every tile
// request failed.
export async function fetchDem(
  bbox4326: Bbox,
  { model = 'dtm', signal }: FetchDemOptions = {},
): Promise<Dem | null> {
  const bbox25833 = transformExtent(bbox4326, 'EPSG:4326', 'EPSG:25833') as [
    number,
    number,
    number,
    number,
  ];

  // Probed on the rectangle, not on the margin: the margin must not pull a
  // finer neighbouring acquisition in and resample the whole grid.
  const coverage = await probeCoverage(model, bbox25833, signal);
  if (coverage === 'none') return null;
  const nativeMetresPerPx =
    coverage === 'unknown' ? FINEST_M_PER_PX : coverage.metresPerPx;

  const grid25833: [number, number, number, number] = [
    bbox25833[0] - DEM_MARGIN_M,
    bbox25833[1] - DEM_MARGIN_M,
    bbox25833[2] + DEM_MARGIN_M,
    bbox25833[3] + DEM_MARGIN_M,
  ];
  const plan = planTiles(grid25833, nativeMetresPerPx, MAX_DEM_PX_PER_SIDE);
  const data = new Float32Array(plan.widthPx * plan.heightPx);
  // Absent tiles must read as no-data, not sea level.
  data.fill(NaN);

  let covered = 0;
  let failed = 0;
  await runWithConcurrency(plan.tiles, MAX_CONCURRENT, async (tile) => {
    const url = buildUrl(model, tile.bbox25833, tile.w, tile.h);
    for (let attempt = 0; attempt < TILE_RETRIES; attempt++) {
      try {
        const raster = readFloatTiff(
          await fetchWithin(
            url,
            { ms: TILE_TIMEOUT_MS, what: 'DEM tile', signal },
            (res) => res.arrayBuffer(),
          ),
        );
        if (blitTile(raster, data, plan.widthPx, tile.dx, tile.dy)) covered++;
        return;
      } catch (err) {
        if (signal?.aborted) return;
        // The breaker is already waiting; a local backoff would only add to it.
        if (isUpstreamDown(err)) {
          failed++;
          return;
        }
        if (attempt === TILE_RETRIES - 1) {
          failed++;
          return;
        }
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  });

  // An all-errored fetch must not reach the reader as an absence of LiDAR;
  // real absence arrives as valid but entirely sparse TIFFs.
  if (covered === 0 && failed > 0) {
    throw new Error('every DEM tile request failed');
  }
  if (covered === 0) return null;

  const metresPerPx = (grid25833[2] - grid25833[0]) / plan.widthPx;
  // Clamped so the window can never name a pixel the grid does not have:
  // planTiles is free to have scaled the whole thing down.
  const inset = Math.min(
    Math.round(DEM_MARGIN_M / metresPerPx),
    Math.floor((plan.widthPx - 1) / 2),
    Math.floor((plan.heightPx - 1) / 2),
  );
  return {
    width: plan.widthPx,
    height: plan.heightPx,
    data,
    bbox25833,
    grid25833,
    window: {
      x: inset,
      y: inset,
      width: plan.widthPx - 2 * inset,
      height: plan.heightPx - 2 * inset,
    },
    metresPerPx,
    nativeMetresPerPx,
    model,
  };
}

// Returns whether the tile carried any real values: a tile outside coverage
// decodes fine but is all NaN.
function blitTile(
  raster: FloatRaster,
  dest: Float32Array,
  destWidth: number,
  dx: number,
  dy: number,
): boolean {
  let any = false;
  for (let y = 0; y < raster.height; y++) {
    const srcRow = y * raster.width;
    const destRow = (dy + y) * destWidth + dx;
    for (let x = 0; x < raster.width; x++) {
      const v = raster.data[srcRow + x];
      dest[destRow + x] = v;
      if (!any && !Number.isNaN(v)) any = true;
    }
  }
  return any;
}

type FloatRaster = { width: number; height: number; data: Float32Array };

const TAG = {
  imageWidth: 256,
  imageLength: 257,
  bitsPerSample: 258,
  compression: 259,
  samplesPerPixel: 277,
  planarConfig: 284,
  tileWidth: 322,
  tileLength: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  sampleFormat: 339,
} as const;

// The endpoint emits one shape only: uncompressed, single-band, 32-bit IEEE
// float, tiled, planar config 1. Georeferencing is ignored — ModelTiepoint is
// always the requested bbox's north-west corner at the requested pixel size.
function readFloatTiff(buffer: ArrayBuffer): FloatRaster {
  const dv = new DataView(buffer);
  const byteOrder = dv.getUint16(0, false);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) {
    throw new Error('not a TIFF');
  }
  const le = byteOrder === 0x4949;
  if (dv.getUint16(2, le) !== 42) throw new Error('not a TIFF');

  const entries = readIfd(dv, le, dv.getUint32(4, le));
  const scalar = (tag: number, fallback?: number): number => {
    const e = entries.get(tag);
    if (!e) {
      if (fallback !== undefined) return fallback;
      throw new Error(`TIFF missing tag ${tag}`);
    }
    return readValues(dv, le, e)[0];
  };

  if (scalar(TAG.compression, 1) !== 1) {
    throw new Error('compressed TIFF not supported');
  }
  if (scalar(TAG.bitsPerSample) !== 32 || scalar(TAG.sampleFormat, 3) !== 3) {
    throw new Error('expected 32-bit float samples');
  }
  if (scalar(TAG.samplesPerPixel, 1) !== 1) {
    throw new Error('expected a single band');
  }
  if (scalar(TAG.planarConfig, 1) !== 1) {
    throw new Error('expected planar config 1');
  }

  const width = scalar(TAG.imageWidth);
  const height = scalar(TAG.imageLength);
  const tileW = scalar(TAG.tileWidth);
  const tileH = scalar(TAG.tileLength);
  const offsets = readValues(dv, le, requireEntry(entries, TAG.tileOffsets));
  const byteCounts = readValues(
    dv,
    le,
    requireEntry(entries, TAG.tileByteCounts),
  );

  const data = new Float32Array(width * height);
  data.fill(NaN);

  const tilesAcross = Math.ceil(width / tileW);
  for (let i = 0; i < offsets.length; i++) {
    // A sparse tile — offset 0, byte count 0 — is how the service says "no
    // LiDAR here", not an error; those pixels stay NaN.
    if (offsets[i] === 0 || byteCounts[i] === 0) continue;

    const originX = (i % tilesAcross) * tileW;
    const originY = Math.floor(i / tilesAcross) * tileH;
    for (let ty = 0; ty < tileH; ty++) {
      const y = originY + ty;
      // Tiles are padded out to full size at the right and bottom edges.
      if (y >= height) break;
      let src = offsets[i] + ty * tileW * 4;
      let dst = y * width + originX;
      const runLength = Math.min(tileW, width - originX);
      for (let tx = 0; tx < runLength; tx++) {
        data[dst++] = dv.getFloat32(src, le);
        src += 4;
      }
    }
  }

  return { width, height, data };
}

type IfdEntry = { type: number; count: number; valueOffset: number };

function readIfd(
  dv: DataView,
  le: boolean,
  offset: number,
): Map<number, IfdEntry> {
  const count = dv.getUint16(offset, le);
  const entries = new Map<number, IfdEntry>();
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * 12;
    entries.set(dv.getUint16(at, le), {
      type: dv.getUint16(at + 2, le),
      count: dv.getUint32(at + 4, le),
      valueOffset: at + 8,
    });
  }
  return entries;
}

function requireEntry(entries: Map<number, IfdEntry>, tag: number): IfdEntry {
  const e = entries.get(tag);
  if (!e) throw new Error(`TIFF missing tag ${tag} (expected a tiled image)`);
  return e;
}

// SHORT (3) and LONG (4) only. Values totalling four bytes or fewer are stored
// inline in the entry; anything larger stores a file offset.
function readValues(dv: DataView, le: boolean, e: IfdEntry): number[] {
  const size = e.type === 3 ? 2 : 4;
  if (e.type !== 3 && e.type !== 4) {
    throw new Error(`unexpected TIFF value type ${e.type}`);
  }
  const base =
    e.count * size <= 4 ? e.valueOffset : dv.getUint32(e.valueOffset, le);
  const out: number[] = new Array(e.count);
  for (let i = 0; i < e.count; i++) {
    out[i] =
      size === 2
        ? dv.getUint16(base + i * 2, le)
        : dv.getUint32(base + i * 4, le);
  }
  return out;
}
