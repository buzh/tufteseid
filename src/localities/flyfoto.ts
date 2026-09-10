// Stitch Norge i bilder (NiB) ortofoto over a lokalitet's bbox into a
// single JPEG, so a user can keep aerial imagery of an area as a Bilde
// without hand-shooting screenshots.
//
// Two sources, one stitcher: the seamless best-available mosaic (default)
// and any single acquisition from the archive (pass a FlyfotoProject —
// see flyfotoProjects.ts), which is what makes the same ground readable
// across decades.
//
// Requests go same-origin through /wms/nib/* (the mosaic) and
// /arcgis/nib/* (one acquisition): Caddy → wmscache (cache) → the
// nib-proxy sidecar (which injects NiB's anonymous access token) →
// services.norgeibilder.no. See nib-proxy/server.mjs and the CLAUDE.md
// "Flyfoto" section. The tiling/paint/concurrency machinery is shared
// with the LiDAR extract (src/lidarExtract/stitch.ts).

import { transformExtent } from 'ol/proj';
import type { LocalityBbox } from '../api/localities';
import {
  fetchAndPaint,
  planTiles,
  runWithConcurrency,
} from '../lidarExtract/stitch';
import type { FlyfotoProject } from './flyfotoProjects';

// Same-origin NiB ortofoto WMS. The published layer name is verified
// against GetCapabilities on deploy — change it here if it differs (see
// the docker rebuild notes / README).
export const FLYFOTO_WMS_URL = '/wms/nib/ortofoto';
export const FLYFOTO_LAYER = 'ortofoto';

// Rendering *one* acquisition instead of the seamless mosaic is not a WMS
// operation: /wms/ortofoto publishes only the merged `ortofoto` layer, and
// the per-project service has no WMS endpoint at all. It is an ArcGIS
// ImageServer whose mosaic catalogue carries a prosjektnavn column, so a
// single project is selected with a mosaicRule `where` clause.
//
// The service root, without the operation: the background layer built on
// the same service in map/layers/config/backgroundLayers/flyfotoBackground.ts
// hands this to OpenLayers, which appends /exportImage itself.
export const FLYFOTO_PROJECT_IMAGESERVER =
  '/arcgis/nib/ortofoto_prosjekter/ImageServer';
const FLYFOTO_PROJECT_URL = `${FLYFOTO_PROJECT_IMAGESERVER}/exportImage`;

// Selects exactly one acquisition out of the ImageServer's mosaic
// catalogue. Doubling is SQL's apostrophe escape; a few project names have
// one. Shared with the background layer so the two paths can never disagree
// about how a name is quoted.
export const flyfotoProjectWhere = (projectId: string): string =>
  `prosjektnavn='${projectId.replace(/'/g, "''")}'`;

// Draw exactly the rasters the where clause selects, in catalogue order,
// with none of the service's default by-date/by-quality preference mixing
// other projects back in.
export const flyfotoMosaicRule = (projectId: string): string =>
  JSON.stringify({
    mosaicMethod: 'esriMosaicNone',
    where: flyfotoProjectWhere(projectId),
  });

// Ortofoto nationally is ~0.10–0.25 m/px; 0.20 keeps a lokalitet-sized
// grab sharp. planTiles scales both axes down together past its canvas
// cap, so on a large bbox the effective resolution is coarser than this —
// hence it's a target, not a floor, and we report the actual value back.
const TARGET_M_PER_PX = 0.2;
// NiB sits behind the same shed-and-retry public edge as Kartverket, so
// keep concurrency modest and let wmscache absorb repeats.
const MAX_CONCURRENT = 4;
const TILE_RETRIES = 3;

export type FlyfotoResult = {
  blob: Blob;
  widthPx: number;
  heightPx: number;
  metresPerPx: number;
  bbox25833: [number, number, number, number];
};

function buildProjectUrl(
  project: FlyfotoProject,
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
    // Plain jpg, not the jpgpng the background layer asks for: a stitch
    // flattens onto an opaque white canvas anyway, and fetchAndPaint's
    // uniform-image check is what drops the no-coverage tiles.
    format: 'jpg',
    mosaicRule: flyfotoMosaicRule(project.id),
  });
  return `${FLYFOTO_PROJECT_URL}?${params.toString()}`;
}

function buildUrl(
  bbox25833: [number, number, number, number],
  widthPx: number,
  heightPx: number,
): string {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: FLYFOTO_LAYER,
    STYLES: '',
    CRS: 'EPSG:25833',
    BBOX: bbox25833.join(','),
    WIDTH: String(widthPx),
    HEIGHT: String(heightPx),
    // Ortofoto is opaque photography — JPEG is far smaller than PNG here
    // and there's no transparency to preserve.
    FORMAT: 'image/jpeg',
  });
  return `${FLYFOTO_WMS_URL}?${params.toString()}`;
}

export type FlyfotoOptions = {
  // Omit for the seamless best-available mosaic; pass one to grab that
  // single acquisition instead.
  project?: FlyfotoProject;
  signal?: AbortSignal;
};

// Returns null when nothing painted — the bbox is entirely outside NiB
// coverage (or outside this project's), or every tile failed.
export async function fetchFlyfoto(
  bbox4326: LocalityBbox,
  { project, signal }: FlyfotoOptions = {},
): Promise<FlyfotoResult | null> {
  const bbox25833 = transformExtent(bbox4326, 'EPSG:4326', 'EPSG:25833') as [
    number,
    number,
    number,
    number,
  ];

  // Never ask for finer than the acquisition actually holds: a 1937 flight
  // at 0.5 m upsampled to 0.2 m is four times the tiles for the same
  // detail. The mosaic has no single native resolution, so it keeps the
  // target.
  const metresPerPx = Math.max(TARGET_M_PER_PX, project?.metresPerPx ?? 0);
  const plan = planTiles(bbox25833, metresPerPx);
  const canvas = document.createElement('canvas');
  canvas.width = plan.widthPx;
  canvas.height = plan.heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Ortofoto is opaque; paint a white base so any no-coverage gap reads
  // as neutral rather than transparent-black once flattened to JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, plan.widthPx, plan.heightPx);

  let painted = 0;
  await runWithConcurrency(plan.tiles, MAX_CONCURRENT, async (tile) => {
    const url = project
      ? buildProjectUrl(project, tile.bbox25833, tile.w, tile.h)
      : buildUrl(tile.bbox25833, tile.w, tile.h);
    for (let attempt = 0; attempt < TILE_RETRIES; attempt++) {
      try {
        const result = await fetchAndPaint(
          url,
          ctx,
          tile.dx,
          tile.dy,
          tile.w,
          tile.h,
          signal,
        );
        if (result === 'painted') painted++;
        return;
      } catch {
        if (signal?.aborted) return;
        if (attempt === TILE_RETRIES - 1) return;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  });

  if (painted === 0) return null;

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.9),
  );
  if (!blob) return null;

  return {
    blob,
    widthPx: plan.widthPx,
    heightPx: plan.heightPx,
    metresPerPx: (bbox25833[2] - bbox25833[0]) / plan.widthPx,
    bbox25833,
  };
}
