// A saved drawing on the map: one transparent layer, re-exporting its scene at
// the resolution the view is showing rather than magnifying a stored image.
//
// One at a time, and that is the whole product for now: the drawing shown is
// the open spot's. Several at once would mean an Excalidraw export per pin in
// the list, which is the wrong trade for a map whose subject is the terrain
// under them.

import { useAtomValue } from 'jotai';
import type { Extent } from 'ol/extent';
import ImageLayer from 'ol/layer/Image';
import type { Size } from 'ol/size';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import { useEffect } from 'react';

import { mapAtom } from '../map/atoms';
import { metresPerScenePx } from './frame';
import { renderScene, type SceneRender } from './render';
import type { Sketch } from './scene';

// The drawing takes z-index 2: over the terrain analysis it was traced from
// (1), under that analysis's frame (4) and under the pin it belongs to (6),
// because it is what is being annotated rather than an annotation of its own.
// The inventory is in docs/map-layers.md.
const Z_INDEX = 2;

// How far the view may drift from the export's resolution before it is redrawn.
// `canvasFunction` runs on every frame of a pinch, so a tolerance near 1 queues
// an Excalidraw render per frame; past half a zoom level the strokes soften.
const RESCALE_TOLERANCE = 1.4;

type Entry = {
  sketch: Sketch;
  out: HTMLCanvasElement | null;
  render: SceneRender | null;
  /** Device pixels per scene unit `render` was made at. */
  renderedScale: number | null;
  /** Non-null while an export is in flight, so only one ever is. */
  pending: number | null;
  /** Cleared on unmount, so a late export cannot touch a layer taken off. */
  live: boolean;
  redraw: () => void;
};

// Re-export if the view has moved far enough to matter. Called from inside
// `canvasFunction`, which cannot wait, so the first frame draws nothing and the
// export asks for a redraw when it lands. A failed export records the scale
// anyway, so it is not retried every frame.
const ensureRender = (entry: Entry, scale: number) => {
  if (entry.pending !== null) return;
  const have = entry.renderedScale;
  if (
    have !== null &&
    scale < have * RESCALE_TOLERANCE &&
    scale * RESCALE_TOLERANCE > have
  ) {
    return;
  }
  entry.pending = scale;
  void renderScene(entry.sketch.frame, entry.sketch.elements, scale)
    .then((render) => {
      if (!entry.live) return;
      entry.pending = null;
      entry.renderedScale = scale;
      if (!render) return;
      entry.render = render;
      entry.redraw();
    })
    .catch((e) => {
      // `renderScene` says it never throws, and this is what makes a broken
      // promise there cost one export rather than the layer: `pending` left set
      // is a guard nothing clears again, and the drawing would stay blank for
      // the rest of the session.
      console.warn('[sketch] overlay render failed', e);
      if (!entry.live) return;
      entry.pending = null;
      entry.renderedScale = scale;
    });
};

const drawEntry =
  (entry: Entry) =>
  (
    extent: Extent,
    resolution: number,
    pixelRatio: number,
    size: Size,
  ): HTMLCanvasElement => {
    const out = (entry.out ??= document.createElement('canvas'));
    const width = Math.round(size[0]);
    const height = Math.round(size[1]);
    if (out.width !== width || out.height !== height) {
      out.width = width;
      out.height = height;
    }
    const ctx = out.getContext('2d');
    if (!ctx) return out;
    ctx.clearRect(0, 0, width, height);

    ensureRender(
      entry,
      (metresPerScenePx(entry.sketch.frame) * pixelRatio) / resolution,
    );
    const render = entry.render;
    if (!render) return out;

    const [minX, minY, maxX, maxY] = render.extent25833;
    const scale = pixelRatio / resolution;
    const w = (maxX - minX) * scale;
    const h = (maxY - minY) * scale;
    if (!(w > 0) || !(h > 0)) return out;
    // Smoothing stays on both ways: the source is line art, so the only step to
    // preserve would be its own aliasing.
    ctx.drawImage(
      render.canvas,
      0,
      0,
      render.canvas.width,
      render.canvas.height,
      (minX - extent[0]) * scale,
      (extent[3] - maxY) * scale,
      w,
      h,
    );
    return out;
  };

/** Draws `sketch` over the ground it was made on, or nothing for null. */
export const useSketchOverlay = (sketch: Sketch | null) => {
  const map = useAtomValue(mapAtom);

  useEffect(() => {
    if (!sketch) return;
    const entry: Entry = {
      sketch,
      out: null,
      render: null,
      renderedScale: null,
      pending: null,
      live: true,
      // Assigned below: the source needs the entry and the entry needs the
      // source.
      redraw: () => {},
    };
    const source = new ImageCanvasSource({
      // Fixed, so a view in another projection reprojects.
      projection: 'EPSG:25833',
      canvasFunction: drawEntry(entry),
    });
    entry.redraw = () => source.changed();

    const layer = new ImageLayer({
      source,
      zIndex: Z_INDEX,
      properties: { id: 'spotSketchOverlay' },
    });
    map.addLayer(layer);

    return () => {
      entry.live = false;
      map.removeLayer(layer);
    };
  }, [map, sketch]);
};
