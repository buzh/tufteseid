import Map from 'ol/Map';
import { unByKey } from 'ol/Observable';
import { transformExtent } from 'ol/proj';
import { LocalityBbox } from '../api/localities';

// 'rendercomplete' only fires once every source has finished loading, so
// a single tile that never settles means it never fires and the promise
// never resolves — the "ta skjermbilde" button stays spinning for good.
// Waiting is normal (a cold LiDAR tile is 3-12 s at Kartverket's
// origin), so the budget is the same generous one the background swap
// uses as its retirement backstop.
const RENDER_TIMEOUT_MS = 15000;

export type LocalityScreenshot = {
  canvas: HTMLCanvasElement;
  // Ground covered, EPSG:25833. Exact for an unrotated view, which is every
  // view unless somebody alt-shift-dragged: under rotation the crop is the
  // screen-aligned bounding box of a turned rectangle, so this is its
  // envelope rather than its outline.
  bbox25833: [number, number, number, number];
  // From the view resolution, so it stays exact under rotation — which is
  // what the figure's scale bar is measured off.
  metresPerPx: number;
  // Radians, positive clockwise, for the figure's north arrow.
  rotation: number;
};

// Capture the current map view cropped to a lokalitet's rectangle.
// Standard OL canvas-export recipe: wait for rendercomplete, composite
// every layer canvas (applying each one's CSS transform + opacity), then
// crop to the rectangle∩viewport in CSS pixels. Safe from canvas taint
// because all tile sources are same-origin via the /wms/* proxies.
//
// Hands back the canvas rather than bytes: the caller runs it through the
// provenance figure (src/figure), which needs somewhere to draw a caption.
//
// Resolves null when the rectangle isn't (meaningfully) in view or
// anything else goes wrong — callers alert, nothing throws.
export const captureLocalityScreenshot = (
  map: Map,
  bbox4326: LocalityBbox,
): Promise<LocalityScreenshot | null> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (shot: LocalityScreenshot | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unByKey(key);
      resolve(shot);
    };

    const timer = setTimeout(() => {
      console.warn('[screenshot] no rendercomplete, giving up');
      finish(null);
    }, RENDER_TIMEOUT_MS);

    const key = map.once('rendercomplete', () => {
      try {
        const size = map.getSize();
        if (!size) return finish(null);
        const view = map.getView();
        const projection = view.getProjection().getCode();
        const extent = transformExtent(bbox4326, 'EPSG:4326', projection);
        const topLeft = map.getPixelFromCoordinate([extent[0], extent[3]]);
        const bottomRight = map.getPixelFromCoordinate([extent[2], extent[1]]);
        if (!topLeft || !bottomRight) return finish(null);

        // Rectangle ∩ viewport, in CSS pixels.
        const sx = Math.max(0, Math.floor(topLeft[0]));
        const sy = Math.max(0, Math.floor(topLeft[1]));
        const ex = Math.min(size[0], Math.ceil(bottomRight[0]));
        const ey = Math.min(size[1], Math.ceil(bottomRight[1]));
        const sw = ex - sx;
        const sh = ey - sy;
        if (sw < 20 || sh < 20) return finish(null);

        const composite = document.createElement('canvas');
        composite.width = size[0];
        composite.height = size[1];
        const ctx = composite.getContext('2d');
        if (!ctx) return finish(null);

        const canvases = map
          .getViewport()
          .querySelectorAll<HTMLCanvasElement>(
            '.ol-layer canvas, canvas.ol-layer',
          );
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
          ctx.setTransform(
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

        const out = document.createElement('canvas');
        out.width = sw;
        out.height = sh;
        const outCtx = out.getContext('2d');
        if (!outCtx) return finish(null);
        outCtx.drawImage(composite, sx, sy, sw, sh, 0, 0, sw, sh);

        // What the crop actually covers, back out of screen space. Four
        // corners rather than two, so a rotated view still yields the right
        // envelope.
        const xs: number[] = [];
        const ys: number[] = [];
        for (const pixel of [
          [sx, sy],
          [ex, sy],
          [sx, ey],
          [ex, ey],
        ]) {
          const coord = map.getCoordinateFromPixel(pixel);
          if (!coord) return finish(null);
          xs.push(coord[0]);
          ys.push(coord[1]);
        }
        const captured: [number, number, number, number] = [
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs),
          Math.max(...ys),
        ];
        const bbox25833 =
          projection === 'EPSG:25833'
            ? captured
            : (transformExtent(captured, projection, 'EPSG:25833') as [
                number,
                number,
                number,
                number,
              ]);

        finish({
          canvas: out,
          bbox25833,
          metresPerPx: view.getResolution() ?? (captured[2] - captured[0]) / sw,
          rotation: view.getRotation(),
        });
      } catch (e) {
        console.warn('[screenshot] capture failed', e);
        finish(null);
      }
    });
    map.renderSync();
  });
