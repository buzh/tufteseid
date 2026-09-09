// Fetch raw float elevation for a bbox, so the client can compute its own
// relief visualizations instead of only re-styling Kartverket's pre-shaded
// hillshade.
//
// Source is hoydedata.no's ArcGIS ImageServer, via exportImage with
// renderingRule {"rasterFunction":"None"} — the service's other raster
// function is `skyggerelieff`, i.e. the same shaded PNG the WMS already
// serves. Same-origin through /arcgis/hoydedata/* → Caddy → wmscache, like
// every other external raster source.
//
// Background, and the endpoint facts this file relies on:
// docs/terrain-analysis.md.

import { transformExtent } from 'ol/proj';
import type { LocalityBbox } from '../api/localities';
import { planTiles, runWithConcurrency } from '../lidarExtract/stitch';

const IMAGE_SERVER_BASE = '/arcgis/hoydedata';

// Terrain (bare earth) vs surface (first return — canopy and buildings).
// Mirrors activeLidarModelAtom on the map background.
export type DemModel = 'dtm' | 'dom';

// TOPOBATHY for DTM matches what the app's national LiDAR background and
// searchApi.ts already use. DOM has no topobathy variant.
const SERVICE: Record<DemModel, string> = {
  dtm: 'NHM_DTM_TOPOBATHY_25833',
  dom: 'NHM_DOM_25833',
};

// The national mosaics are 1 m native; asking for finer just interpolates.
const NATIVE_M_PER_PX = 1;

// Cap the assembled grid. Unlike a canvas extract this is a Float32Array we
// then run neighbourhood operators over several times, so the ceiling is
// about working memory and CPU, not just allocation: 3000² is 36 MB and a
// sky-view factor pass over it is already a few seconds. planTiles scales
// resolution down to fit, so a huge lokalitet still works — just coarser.
const MAX_DEM_PX_PER_SIDE = 3000;

// Well under the service's declared maxImageWidth/Height of 4096 for the
// national mosaics; planTiles' own MAX_TILE_PX (2048) is what actually
// bounds a single request.
const MAX_CONCURRENT = 3;
const TILE_RETRIES = 3;

export type Dem = {
  width: number;
  height: number;
  // Row-major, north-up (row 0 is the northern edge), metres above the
  // vertical datum. NaN marks no coverage — see readFloatTiff.
  data: Float32Array;
  bbox25833: [number, number, number, number];
  metresPerPx: number;
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
    // Bilinear is the service default, but be explicit: nearest-neighbour
    // resampling puts stair-steps into the derivatives, which is exactly
    // what a hillshade amplifies.
    interpolation: 'RSP_BilinearInterpolation',
    renderingRule: JSON.stringify({ rasterFunction: 'None' }),
  });
  return `${IMAGE_SERVER_BASE}/${SERVICE[model]}/ImageServer/exportImage?${params.toString()}`;
}

export type FetchDemOptions = {
  model?: DemModel;
  signal?: AbortSignal;
};

// Returns null when the bbox is entirely outside LiDAR coverage, or every
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

  const plan = planTiles(bbox25833, NATIVE_M_PER_PX, MAX_DEM_PX_PER_SIDE);
  const data = new Float32Array(plan.widthPx * plan.heightPx);
  // Absent tiles must read as no-data, not as sea level: a failed or
  // uncovered tile left at 0 would be a cliff edge in every derivative.
  data.fill(NaN);

  let covered = 0;
  let failed = 0;
  await runWithConcurrency(plan.tiles, MAX_CONCURRENT, async (tile) => {
    const url = buildUrl(model, tile.bbox25833, tile.w, tile.h);
    for (let attempt = 0; attempt < TILE_RETRIES; attempt++) {
      try {
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raster = readFloatTiff(await res.arrayBuffer());
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

  // "Nothing came back" and "nothing is there" are different answers and the
  // UI says different things about them. A bbox outside coverage returns
  // perfectly good, entirely sparse TIFFs — that's the null case. If instead
  // every request errored, this is a failure and must not be reported to the
  // user as an absence of LiDAR.
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
    model,
  };
}

// Copy a decoded tile into the assembled grid. Returns whether it carried
// any real values — a tile fully outside coverage decodes fine but is all
// NaN, and a bbox where every tile is like that is "no coverage here"
// rather than a failure.
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
//
// Deliberately not geotiff.js. This endpoint emits one shape and only one:
// uncompressed, single-band, 32-bit IEEE float, tiled 128×128, planar
// config 1. Handling exactly that is ~100 lines; the library is ~500 KB of
// support for variants we never see, and pulling it in would mean
// regenerating package-lock.json, which the workstation can't do (the
// Dockerfile runs `npm ci` and there's no local toolchain — see CLAUDE.md).
//
// Georeferencing is ignored on purpose: ModelTiepoint always comes back as
// the north-west corner of the bbox we asked for, at the pixel size we asked
// for, so the request *is* the georeferencing.

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

  // Guard the assumptions rather than silently mis-decoding. If the service
  // ever starts compressing, this throws a legible error instead of
  // producing a field of garbage elevations.
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
    // A sparse tile — offset 0 and byte count 0 — is how this service says
    // "no LiDAR here". Not an error: a bbox straddling the coverage edge
    // legitimately returns a mix of present and absent tiles. Leave those
    // pixels NaN.
    if (offsets[i] === 0 || byteCounts[i] === 0) continue;

    const originX = (i % tilesAcross) * tileW;
    const originY = Math.floor(i / tilesAcross) * tileH;
    for (let ty = 0; ty < tileH; ty++) {
      const y = originY + ty;
      // Tiles are padded out to full size at the right and bottom edges;
      // the padding lies outside the image and is skipped.
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

function requireEntry(
  entries: Map<number, IfdEntry>,
  tag: number,
): IfdEntry {
  const e = entries.get(tag);
  // Only reachable if the service switches to strip layout, which it has
  // never been observed to do for exportImage.
  if (!e) throw new Error(`TIFF missing tag ${tag} (expected a tiled image)`);
  return e;
}

// SHORT (3) and LONG (4) are the only types these tags use. Values totalling
// four bytes or fewer are stored inline in the entry itself; anything larger
// puts a file offset there instead.
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
      size === 2 ? dv.getUint16(base + i * 2, le) : dv.getUint32(base + i * 4, le);
  }
  return out;
}
