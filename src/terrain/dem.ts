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

// The *per-acquisition* mosaics, not the national ones. The national
// NHM_DTM_TOPOBATHY_25833 / NHM_DOM_25833 are 1 m, and — measured, see
// docs/terrain-analysis.md — they are also mixed: where NHM never flew,
// their catalogue falls through to DTM10 rows carrying MINPS 0, so the
// service happily serves 10 m data interpolated up to whatever cell size
// you ask for. Nothing in the response says so.
//
// Prosjekt_DTM / Prosjekt_DOM are 0.25 m and honest about the same gaps:
// their DTM10 rows carry MINPS 27, so below 27 m/px those rows drop out of
// the mosaic and an uncovered pixel comes back as no-data. Coverage was
// probed against the national mosaic at 120 random land points: 99 had real
// LiDAR in both, 21 had it in neither (the national mosaic returning
// DTM10, pixel-identical to its own LOWPS>=10 sub-mosaic), and **none** had
// LiDAR nationally but not per-project. So this loses no laser data
// anywhere — it only stops dressing 10 m contours up as terrain.
const SERVICE: Record<DemModel, string> = {
  dtm: 'Prosjekt_DTM',
  dom: 'Prosjekt_DOM',
};

// Where acquisitions overlap, take the finest. That is already Prosjekt_DTM's
// service default (defaultMosaicMethod ByAttribute, sortField lowps), but
// Prosjekt_DOM defaults to Northwest — which picks by where a raster sits
// rather than by what it is worth — so the rule has to be stated to make the
// two models behave the same.
const MOSAIC_RULE = JSON.stringify({
  mosaicMethod: 'esriMosaicAttribute',
  sortField: 'lowps',
  sortValue: 0,
});

// The finest the per-project services publish, and the target when the
// coverage probe below can't say better. Acquisitions come in 0.25, 0.5 and
// 1 m; asking for 0.25 m over a 0.5 m project is four times the pixels — and
// four times the sky-view factor — for interpolation, which is the same
// mistake as the national mosaic one notch down.
const FINEST_M_PER_PX = 0.25;

// Cap the assembled grid. Unlike a canvas extract this is a Float32Array we
// then run neighbourhood operators over several times, so the ceiling is
// about working memory and CPU, not just allocation: 3000² is 36 MB and a
// sky-view factor pass over it is already a few seconds. planTiles scales
// resolution down to fit, so a huge lokalitet still works — just coarser.
//
// Unchanged by the move to 0.25 m sources, so nothing comes back coarser
// than it used to. Small rectangles do get up to four times finer, which is
// sixteen times the pixels — the panel prints the resolution it settled on
// precisely because that trade is now visible in how long a render takes.
const MAX_DEM_PX_PER_SIDE = 3000;

// Well under the per-project services' declared maxImageWidth/Height of
// 15000; planTiles' own MAX_TILE_PX (2048) is what actually bounds a single
// request.
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
  // What the finest acquisition covering the rectangle actually publishes.
  // Equal to metresPerPx when the grid fits under MAX_DEM_PX_PER_SIDE, and
  // finer than it when the rectangle was too large and had to be sampled
  // down — the difference is the only way to tell "this is all the detail
  // there is" from "there is more, ask for a smaller area".
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
    // Bilinear is the service default, but be explicit: nearest-neighbour
    // resampling puts stair-steps into the derivatives, which is exactly
    // what a hillshade amplifies.
    interpolation: 'RSP_BilinearInterpolation',
    renderingRule: JSON.stringify({ rasterFunction: 'None' }),
    mosaicRule: MOSAIC_RULE,
  });
  return `${IMAGE_SERVER_BASE}/${SERVICE[model]}/ImageServer/exportImage?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Coverage probe
// ---------------------------------------------------------------------------
//
// One ~200-byte catalogue query, before any pixels, asking the mosaic
// catalogue for the finest OPPLOSNING among the acquisitions intersecting
// the rectangle. Two answers come out of it: what resolution is worth
// requesting, and whether there is any laser data here at all.
//
// It reads the *envelope*, so an acquisition clipping one corner sets the
// target for the whole grid. That errs towards detail rather than away from
// it, which is the right way to be wrong here.

// 'none' is the catalogue answering that nothing covers this. 'unknown' is
// the probe itself failing, which must not be reported as an absence — fall
// back to the finest and let the tiles decide.
type Coverage = { metresPerPx: number } | 'none' | 'unknown';

// wmscache declines to store responses under 1000 bytes (see
// nginx/wms-proxy-common.conf — the rule that keeps WMS error bodies out of
// a 180-day cache), and this response is nowhere near that. Memoise in-tab
// instead: "Juster området" refetches the DEM on every resize and the
// catalogue does not change between two of them.
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
    // The catalogue also holds the 10 m fallback rows, which have no
    // OPPLOSNING. Excluding them is what makes a null answer mean "no laser
    // data" rather than "no laser data but plenty of contour model".
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
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body?.error) throw new Error('catalogue query rejected');
    // Two quirks of the reply, both load-bearing: the service upper-cases
    // outStatisticFieldName, and "nothing covers this" arrives as one
    // feature holding a *null* statistic, not as an empty features array.
    const attrs = body?.features?.[0]?.attributes;
    const best = attrs ? (attrs.BEST ?? attrs.best) : null;
    if (typeof best !== 'number' || !(best > 0)) return 'none';
    return { metresPerPx: best };
  })();

  // A failed probe must not be remembered — the next attempt should get to
  // ask again — but the result of a successful one is a fact about the
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

  const coverage = await probeCoverage(model, bbox25833, signal);
  // The catalogue said nothing covers this. Same answer as an all-sparse
  // stitch, arrived at for one small request instead of a screenful of
  // multi-megabyte ones.
  if (coverage === 'none') return null;
  const nativeMetresPerPx =
    coverage === 'unknown' ? FINEST_M_PER_PX : coverage.metresPerPx;

  const plan = planTiles(bbox25833, nativeMetresPerPx, MAX_DEM_PX_PER_SIDE);
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
    nativeMetresPerPx,
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
