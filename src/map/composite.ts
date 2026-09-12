import Map from 'ol/Map';
import { unByKey } from 'ol/Observable';

/*
 * Flattening the map's layer canvases into one.
 *
 * Two callers want this and want it differently: `localities/screenshot.ts`
 * composites at CSS resolution and crops to the lokalitet's rectangle, and
 * `funn/snapshot.ts` composites the whole viewport at device resolution to
 * freeze under the drawing surface. The recipe underneath is the same
 * standard OpenLayers canvas-export dance, so it lives here once.
 *
 * What this catches is every `.ol-layer` canvas — which is to say the map.
 * What it does *not* catch is `ol/Overlay`, which is DOM: the funn callout,
 * the Kulturminner popup, the search marker popup. Those are transient
 * things you would not want baked into either output anyway, but it is the
 * reason a drawn point icon rendered as a DOM overlay never once appeared in
 * a saved figure.
 */

// 'rendercomplete' only fires once every source has finished loading, so a
// single tile that never settles means it never fires. Waiting is normal (a
// cold LiDAR tile is 3-12 s at Kartverket's origin), so the budget is the
// same generous one the background swap uses as its retirement backstop.
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
 * Every layer canvas drawn into one, in layer order, honouring each one's CSS
 * transform, opacity and background colour.
 *
 * `scale` multiplies the output resolution: 1 gives CSS pixels, and
 * `devicePixelRatio` gives the pixels the screen is actually showing — which
 * is what a freeze has to match to look like nothing happened.
 *
 * Safe from canvas taint because every tile source is same-origin through the
 * /wms/* proxies. Returns null if the map has no size yet.
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
    // The layer's own matrix takes its device pixels into CSS pixels; `scale`
    // then takes CSS pixels into output pixels. Composed in that order rather
    // than multiplied by hand, so scale === 1 is bit-for-bit what this code
    // did before it moved here.
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
