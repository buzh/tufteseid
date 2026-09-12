import Map from 'ol/Map';
import { transformExtent } from 'ol/proj';
import { LocalityBbox } from '../api/localities';
import { compositeMapCanvases, whenRendered } from '../map/composite';

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

// Capture the current map view cropped to a lokalitet's rectangle: wait for
// the map to settle, flatten its layers (`map/composite.ts`), then crop to
// the rectangle∩viewport in CSS pixels.
//
// Hands back the canvas rather than bytes: the caller runs it through the
// provenance figure (src/figure), which needs somewhere to draw a caption.
//
// Resolves null when the rectangle isn't (meaningfully) in view or anything
// else goes wrong — callers alert, nothing throws.
export const captureLocalityScreenshot = async (
  map: Map,
  bbox4326: LocalityBbox,
): Promise<LocalityScreenshot | null> => {
  const settled = whenRendered(map);
  map.renderSync();
  if (!(await settled)) return null;

  try {
    const size = map.getSize();
    if (!size) return null;
    const view = map.getView();
    const projection = view.getProjection().getCode();
    const extent = transformExtent(bbox4326, 'EPSG:4326', projection);
    const topLeft = map.getPixelFromCoordinate([extent[0], extent[3]]);
    const bottomRight = map.getPixelFromCoordinate([extent[2], extent[1]]);
    if (!topLeft || !bottomRight) return null;

    // Rectangle ∩ viewport, in CSS pixels.
    const sx = Math.max(0, Math.floor(topLeft[0]));
    const sy = Math.max(0, Math.floor(topLeft[1]));
    const ex = Math.min(size[0], Math.ceil(bottomRight[0]));
    const ey = Math.min(size[1], Math.ceil(bottomRight[1]));
    const sw = ex - sx;
    const sh = ey - sy;
    if (sw < 20 || sh < 20) return null;

    const composite = compositeMapCanvases(map, 1);
    if (!composite) return null;

    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    const outCtx = out.getContext('2d');
    if (!outCtx) return null;
    outCtx.drawImage(composite, sx, sy, sw, sh, 0, 0, sw, sh);

    // What the crop actually covers, back out of screen space. Four corners
    // rather than two, so a rotated view still yields the right envelope.
    const xs: number[] = [];
    const ys: number[] = [];
    for (const pixel of [
      [sx, sy],
      [ex, sy],
      [sx, ey],
      [ex, ey],
    ]) {
      const coord = map.getCoordinateFromPixel(pixel);
      if (!coord) return null;
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

    return {
      canvas: out,
      bbox25833,
      metresPerPx: view.getResolution() ?? (captured[2] - captured[0]) / sw,
      rotation: view.getRotation(),
    };
  } catch (e) {
    console.warn('[screenshot] capture failed', e);
    return null;
  }
};
