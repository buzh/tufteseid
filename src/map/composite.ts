import Map from 'ol/Map';
import { unByKey } from 'ol/Observable';

// Flattening the map's layer canvases into one. It catches every `.ol-layer`
// canvas and nothing served by `ol/Overlay`, which is DOM, so the funn callout,
// the Kulturminner popup and the search marker cannot reach a saved figure.

// 'rendercomplete' waits for every source, so one tile that never settles means
// it never fires. A cold LiDAR tile is 3-12 s, so waiting is normal.
export const RENDER_TIMEOUT_MS = 15000;

/**
 * Resolves true once the map has finished drawing, false if it never does.
 * Never rejects — callers decide what an unsettled map means for them.
 */
export const whenRendered = (
  map: Map,
  timeoutMs = RENDER_TIMEOUT_MS,
): Promise<boolean> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unByKey(key);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      console.warn('[composite] no rendercomplete, giving up');
      finish(false);
    }, timeoutMs);
    const key = map.once('rendercomplete', () => finish(true));
  });

/**
 * Every layer canvas drawn into one, honouring each one's CSS transform,
 * opacity and background colour. `scale` multiplies the output resolution: 1 is
 * CSS pixels. Null if the map has no size yet; never tainted, since every tile
 * source is same-origin through the /wms/* proxies.
 */
export const compositeMapCanvases = (
  map: Map,
  scale = 1,
): HTMLCanvasElement | null => {
  const size = map.getSize();
  if (!size) return null;

  const out = document.createElement('canvas');
  out.width = Math.round(size[0] * scale);
  out.height = Math.round(size[1] * scale);
  const ctx = out.getContext('2d');
  if (!ctx) return null;

  const canvases = map
    .getViewport()
    .querySelectorAll<HTMLCanvasElement>('.ol-layer canvas, canvas.ol-layer');

  canvases.forEach((canvas) => {
    if (canvas.width === 0) return;
    const parent = canvas.parentNode as HTMLElement | null;
    const opacity = parent?.style.opacity || canvas.style.opacity;
    ctx.globalAlpha = opacity === '' ? 1 : Number(opacity);
    const backgroundColor = parent?.style.backgroundColor;
    const transform = canvas.style.transform;
    let matrix: number[];
    if (transform) {
      const match = transform.match(/^matrix\(([^(]*)\)$/);
      if (!match) return;
      matrix = match[1].split(',').map(Number);
    } else {
      matrix = [
        parseFloat(canvas.style.width) / canvas.width,
        0,
        0,
        parseFloat(canvas.style.height) / canvas.height,
        0,
        0,
      ];
    }
    // Device pixels → CSS pixels → output pixels, composed in that order.
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.transform(
      matrix[0],
      matrix[1],
      matrix[2],
      matrix[3],
      matrix[4],
      matrix[5],
    );
    if (backgroundColor) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(canvas, 0, 0);
  });

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  return out;
};
