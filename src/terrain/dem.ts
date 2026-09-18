// Raw float elevation for a bbox, so the client can compute its own relief
// rather than re-style a pre-shaded hillshade. hoydedata.no's ArcGIS
// ImageServer via exportImage with renderingRule {"rasterFunction":"None"} —
// its other raster function, `skyggerelieff`, is the shaded PNG the WMS serves
// — same-origin through /arcgis/hoydedata/*. Endpoint facts:
// docs/terrain-analysis.md.

import { transformExtent } from 'ol/proj';
import type { LocalityBbox } from '../api/localities';
import { planTiles, runWithConcurrency } from '../lidarExtract/stitch';
import { MAX_SIDE_M } from '../localities/bboxLimits';
import { fetchWithin } from '../shared/utils/deadline';

const IMAGE_SERVER_BASE = '/arcgis/hoydedata';

// Terrain (bare earth) vs surface (first return — canopy and buildings).
// Mirrors activeLidarModelAtom on the map background.
export type DemModel = 'dtm' | 'dom';

// The per-acquisition mosaics at 0.25 m, not the national NHM_* ones at 1 m:
// where NHM never flew, the national catalogue falls through to DTM10 rows
// carrying MINPS 0, so the service serves 10 m data upsampled and says nothing
// about it. The per-project DTM10 rows carry MINPS 27 instead, so below 27 m/px
// they drop out and an uncovered pixel comes back as no-data. Probing 120
// random land points found no place with LiDAR nationally but not per-project.
const SERVICE: Record<DemModel, string> = {
  dtm: 'Prosjekt_DTM',
  dom: 'Prosjekt_DOM',
};

// Where acquisitions overlap, take the finest. Already Prosjekt_DTM's service
// default, but Prosjekt_DOM defaults to a Northwest mosaic method, so the rule
// is stated explicitly to keep the two models alike.
const MOSAIC_RULE = JSON.stringify({
  mosaicMethod: 'esriMosaicAttribute',
  sortField: 'lowps',
  sortValue: 0,
});

// The finest the per-project services publish, and the target when the coverage
// probe below can't say better. Acquisitions come in 0.25, 0.5 and 1 m, and
// asking for more than a project holds only buys interpolation.
const FINEST_M_PER_PX = 0.25;

// Cap the assembled grid. Derived rather than chosen, so the two numbers
// cannot drift: a rectangle is bounded by MAX_SIDE_M and the finest elevation
// data is FINEST_M_PER_PX, so this is exactly what an in-band rectangle asks
// for at native resolution and nothing in the band is ever resampled.
// planTiles still scales down if one arrives out of band.
const MAX_DEM_PX_PER_SIDE = MAX_SIDE_M / FINEST_M_PER_PX;

const MAX_CONCURRENT = 3;
const TILE_RETRIES = 3;

// Ceilings on a stall, not budgets: the catalogue query answers in well under a
// second, while a tile is a 2048² float TIFF rendered on demand.
const CATALOGUE_TIMEOUT_MS = 20_000;
const TILE_TIMEOUT_MS = 60_000;

export type Dem = {
  width: number;
  height: number;
  // Row-major, north-up (row 0 is the northern edge), metres above the vertical
  // datum; NaN marks no coverage.
  data: Float32Array;
  bbox25833: [number, number, number, number];
  metresPerPx: number;
  // What the finest acquisition covering the rectangle publishes: equal to
  // metresPerPx when the grid fits under MAX_DEM_PX_PER_SIDE, finer than it
  // when the rectangle was too large and had to be sampled down.
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
    // Explicit though it is the service default: nearest-neighbour resampling
    // puts stair-steps into the derivatives, which a hillshade amplifies.
    interpolation: 'RSP_BilinearInterpolation',
    renderingRule: JSON.stringify({ rasterFunction: 'None' }),
    mosaicRule: MOSAIC_RULE,
  });
  return `${IMAGE_SERVER_BASE}/${SERVICE[model]}/ImageServer/exportImage?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Coverage probe
// ---------------------------------------------------------------------------
// One catalogue query before any pixels: the finest OPPLOSNING among the
// acquisitions intersecting the rectangle, which also answers whether there is
// any laser data here at all. It reads the *envelope*, so an acquisition
// clipping one corner sets the target for the whole grid.

// 'none' is the catalogue answering that nothing covers this; 'unknown' is the
// probe itself failing, which must not be reported as an absence.
type Coverage = { metresPerPx: number } | 'none' | 'unknown';

// wmscache declines to store responses under 1000 bytes and this one is far
// under, so memoise in-tab: "Juster området" refetches the DEM on every resize
// and the catalogue does not change between two of them.
const coverageCache = new Map<string, Promise<Coverage>>();

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
    // The 10 m fallback rows have no OPPLOSNING, and excluding them is what
    // makes a null answer mean "no laser data".
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
    // The service upper-cases outStatisticFieldName, and "nothing covers this"
    // arrives as one feature with a null statistic, not an empty features array.
    const attrs = body?.features?.[0]?.attributes;
    const best = attrs ? (attrs.BEST ?? attrs.best) : null;
    if (typeof best !== 'number' || !(best > 0)) return 'none';
    return { metresPerPx: best };
  })();

  // A failed probe must not be remembered; a successful one is a fact about the
  // catalogue and keeps.
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
// request failed. Same contract as fetchFlyfoto.
export async function fetchDem(
  bbox4326: LocalityBbox,
  { model = 'dtm', signal }: FetchDemOptions = {},
): Promise<Dem | null> {
  const bbox25833 = transformExtent(bbox4326, 'EPSG:4326', 'EPSG:25833') as [
    number,
    number,
    number,
    number,
  ];

  const coverage = await probeCoverage(model, bbox25833, signal);
  // Same answer as an all-sparse stitch, for one small request instead of a
  // screenful of multi-megabyte ones.
  if (coverage === 'none') return null;
  const nativeMetresPerPx =
    coverage === 'unknown' ? FINEST_M_PER_PX : coverage.metresPerPx;

  const plan = planTiles(bbox25833, nativeMetresPerPx, MAX_DEM_PX_PER_SIDE);
  const data = new Float32Array(plan.widthPx * plan.heightPx);
  // Absent tiles must read as no-data, not sea level: a tile left at 0 is a
  // cliff edge in every derivative.
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
      } catch {
        if (signal?.aborted) return;
        if (attempt === TILE_RETRIES - 1) {
          failed++;
          return;
        }
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  });

  // "Nothing came back" and "nothing is there" are different answers: a bbox
  // outside coverage returns good, entirely sparse TIFFs, while an all-errored
  // fetch must not reach the user as an absence of LiDAR.
  if (covered === 0 && failed > 0) {
    throw new Error('every DEM tile request failed');
  }
  if (covered === 0) return null;

  return {
    width: plan.widthPx,
    height: plan.heightPx,
    data,
    bbox25833,
    metresPerPx: (bbox25833[2] - bbox25833[0]) / plan.widthPx,
    nativeMetresPerPx,
    model,
  };
}

// Copy a decoded tile into the assembled grid, returning whether it carried any
// real values: a tile outside coverage decodes fine but is all NaN.
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

// ---------------------------------------------------------------------------
// Minimal TIFF reader
// ---------------------------------------------------------------------------
// Deliberately not geotiff.js: this endpoint emits exactly one shape —
// uncompressed, single-band, 32-bit IEEE float, tiled 128×128, planar config 1
// — and a dependency would mean regenerating package-lock.json, which this
// workstation cannot do. Georeferencing is ignored: ModelTiepoint is always the
// north-west corner of the bbox asked for at the pixel size asked for, so the
// request *is* the georeferencing.

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

  // Guard the assumptions rather than silently mis-decoding a field of garbage
  // elevations if the service ever changes shape.
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
    // LiDAR here", not an error: a bbox on the coverage edge legitimately mixes
    // present and absent tiles, and those pixels stay NaN.
    if (offsets[i] === 0 || byteCounts[i] === 0) continue;

    const originX = (i % tilesAcross) * tileW;
    const originY = Math.floor(i / tilesAcross) * tileH;
    for (let ty = 0; ty < tileH; ty++) {
      const y = originY + ty;
      // Tiles are padded out to full size at the right and bottom edges, and
      // the padding lies outside the image.
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
  // Only reachable if the service switches to a strip layout.
  if (!e) throw new Error(`TIFF missing tag ${tag} (expected a tiled image)`);
  return e;
}

// SHORT (3) and LONG (4) are the only types these tags use; values totalling
// four bytes or fewer are stored inline, anything larger puts a file offset.
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
