import { fetchWithin } from '../shared/utils/deadline';
import { LidarSource } from './sources';

const TILE_TIMEOUT_MS = 45_000;

export const MAX_TILE_PX = 2048;

export const MAX_CANVAS_PX_PER_SIDE = 12000;

export type TilePlan = {
  widthPx: number;
  heightPx: number;
  tiles: Array<{
    dx: number;
    dy: number;
    w: number;
    h: number;
    bbox25833: [number, number, number, number];
  }>;
};

export function planTiles(
  bbox: [number, number, number, number],
  metresPerPx: number,
  maxSidePx: number = MAX_CANVAS_PX_PER_SIDE,
): TilePlan {
  const [minX, minY, maxX, maxY] = bbox;
  const worldWidthM = maxX - minX;
  const worldHeightM = maxY - minY;

  let widthPx = Math.max(1, Math.round(worldWidthM / metresPerPx));
  let heightPx = Math.max(1, Math.round(worldHeightM / metresPerPx));

  const scale = Math.min(1, maxSidePx / Math.max(widthPx, heightPx));
  widthPx = Math.max(1, Math.round(widthPx * scale));
  heightPx = Math.max(1, Math.round(heightPx * scale));

  const effectiveMetresPerPx = worldWidthM / widthPx;

  const cols = Math.ceil(widthPx / MAX_TILE_PX);
  const rows = Math.ceil(heightPx / MAX_TILE_PX);
  const baseTileW = Math.ceil(widthPx / cols);
  const baseTileH = Math.ceil(heightPx / rows);

  const tiles: TilePlan['tiles'] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dx = c * baseTileW;
      const dy = r * baseTileH;
      const w = Math.min(baseTileW, widthPx - dx);
      const h = Math.min(baseTileH, heightPx - dy);
      const tileMinX = minX + dx * effectiveMetresPerPx;
      const tileMaxX = tileMinX + w * effectiveMetresPerPx;
      const tileMaxY = maxY - dy * effectiveMetresPerPx;
      const tileMinY = tileMaxY - h * effectiveMetresPerPx;
      tiles.push({
        dx,
        dy,
        w,
        h,
        bbox25833: [tileMinX, tileMinY, tileMaxX, tileMaxY],
      });
    }
  }
  return { widthPx, heightPx, tiles };
}

export function buildGetMapUrl(
  source: LidarSource,
  style: string,
  bbox: [number, number, number, number],
  widthPx: number,
  heightPx: number,
): string {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: `${source.layerPrefix}:${style}`,
    STYLES: '',
    CRS: 'EPSG:25833',
    BBOX: bbox.join(','),
    WIDTH: String(widthPx),
    HEIGHT: String(heightPx),
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
  });
  return `${source.wmsUrl}?${params.toString()}`;
}

export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const queue = items.map((item, index) => ({ item, index }));
  const workers = Array.from({ length: Math.min(limit, queue.length) }, () =>
    (async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) return;
        try {
          await worker(next.item, next.index);
        } catch {}
      }
    })(),
  );
  await Promise.all(workers);
}

export type TileResult = 'painted' | 'blank';

export async function fetchAndPaint(
  url: string,
  ctx: CanvasRenderingContext2D,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  signal?: AbortSignal,
): Promise<TileResult> {
  const blob = await fetchWithin(
    url,
    { ms: TILE_TIMEOUT_MS, what: 'tile', signal },
    (res) => res.blob(),
  );
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    if (isUniformImage(img)) return 'blank';
    ctx.drawImage(img, dx, dy, dw, dh);
    return 'painted';
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = url;
  });
}

function isUniformImage(img: HTMLImageElement): boolean {
  const sampleSize = 16;
  const oc = document.createElement('canvas');
  oc.width = sampleSize;
  oc.height = sampleSize;
  const octx = oc.getContext('2d', { willReadFrequently: true });
  if (!octx) return false;
  octx.drawImage(img, 0, 0, sampleSize, sampleSize);
  const data = octx.getImageData(0, 0, sampleSize, sampleSize).data;
  const r0 = data[0];
  const g0 = data[1];
  const b0 = data[2];
  const a0 = data[3];
  for (let i = 4; i < data.length; i += 4) {
    if (
      data[i] !== r0 ||
      data[i + 1] !== g0 ||
      data[i + 2] !== b0 ||
      data[i + 3] !== a0
    ) {
      return false;
    }
  }
  return true;
}
