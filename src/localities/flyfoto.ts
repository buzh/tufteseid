// Stitch Norge i bilder (NiB) ortofoto over a lokalitet's bbox into a
// single JPEG, so a user can keep aerial imagery of an area as a Bilde
// without hand-shooting screenshots.
//
// Requests go same-origin through /wms/nib/*: Caddy → wmscache (cache) →
// the nib-proxy sidecar (which injects NiB's anonymous access token) →
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

// Same-origin NiB ortofoto WMS. The published layer name is verified
// against GetCapabilities on deploy — change it here if it differs (see
// the docker rebuild notes / README).
export const FLYFOTO_WMS_URL = '/wms/nib/ortofoto';
export const FLYFOTO_LAYER = 'ortofoto';

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

// Returns null when nothing painted — the bbox is entirely outside NiB
// coverage, or every tile failed.
export async function fetchFlyfoto(
  bbox4326: LocalityBbox,
  signal?: AbortSignal,
): Promise<FlyfotoResult | null> {
  const bbox25833 = transformExtent(bbox4326, 'EPSG:4326', 'EPSG:25833') as [
    number,
    number,
    number,
    number,
  ];

  const plan = planTiles(bbox25833, TARGET_M_PER_PX);
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
    const url = buildUrl(tile.bbox25833, tile.w, tile.h);
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
