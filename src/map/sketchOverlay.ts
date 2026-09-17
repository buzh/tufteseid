// The sketches on the map: one transparent layer per shown sketch at zIndex 2,
// above the ground overlay and below the funn, each re-exporting its scene at
// the resolution the view is showing rather than magnifying a stored PNG.
// Module-level and imperative — the redraws are driven by the view, not React.

import { atom, getDefaultStore } from 'jotai';
import type { Extent } from 'ol/extent';
import ImageLayer from 'ol/layer/Image';
import type { Size } from 'ol/size';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import { metresPerScenePx, type FunnFrame } from '../funn/frame';
import { renderScene, type SceneRender } from '../funn/render';
import type { SceneElement } from '../funn/scene';
import { mapAtom } from './atoms';

const Z_INDEX = 2;

// How far the view may drift from a sketch's export resolution before it is
// re-exported. `canvasFunction` runs on every frame of a pinch, so a tolerance
// near 1 queues an Excalidraw render per frame; past half a zoom level the
// strokes soften.
const RESCALE_TOLERANCE = 1.4;

export const sketchShownAtom = atom<ReadonlySet<string>>(new Set<string>());

/** How far each shown sketch is faded, 0–100 by attachment id; missing is 100.
 * `setSketchOverlays` is the one boundary that converts to OL's 0–1. */
export const sketchOpacityAtom = atom<ReadonlyMap<string, number>>(
  new Map<string, number>(),
);

/** [Skisse]'s label toggle. A flag of its own, applied as layer visibility, so
 * the group comes back without re-rendering every scene. */
export const sketchGroupShownAtom = atom(true);

export type SketchOverlay = {
  id: string;
  frame: FunnFrame;
  elements: readonly SceneElement[];
  opacity: number;
};

type Entry = {
  spec: SketchOverlay;
  layer: ImageLayer<ImageCanvasSource>;
  out: HTMLCanvasElement | null;
  render: SceneRender | null;
  /** Device pixels per scene unit `render` was made at. */
  renderedScale: number | null;
  /** Non-null while an export is in flight, so only one ever is. */
  pendingScale: number | null;
  /** Bumped when the scene is replaced: an in-flight export lands on the same
   * entry object, so identity alone cannot tell the two apart. */
  generation: number;
};

const entries = new Map<string, Entry>();

// Re-export if the view has moved far enough to matter. Called from inside
// `canvasFunction`, which cannot wait, so the first frame draws nothing and the
// export calls `changed()` when it lands. A failed export records the scale
// anyway, so it is not retried every frame.
const ensureRender = (entry: Entry, scale: number) => {
  if (entry.pendingScale !== null) return;
  const have = entry.renderedScale;
  if (have !== null && scale < have * RESCALE_TOLERANCE && scale * RESCALE_TOLERANCE > have) {
    return;
  }
  entry.pendingScale = scale;
  const generation = entry.generation;
  void renderScene(entry.spec.frame, entry.spec.elements, { scale }).then(
    (render) => {
      // `pendingScale` is cleared inside the guard: a superseded export must
      // not clear the marker a newer one is holding.
      if (entries.get(entry.spec.id) !== entry) return;
      if (entry.generation !== generation) return;
      entry.pendingScale = null;
      entry.renderedScale = scale;
      if (!render) return;
      entry.render = render;
      entry.layer.getSource()?.changed();
    },
  );
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
      (metresPerScenePx(entry.spec.frame) * pixelRatio) / resolution,
    );
    const render = entry.render;
    if (!render) return out;

    const [minX, minY, maxX, maxY] = render.bbox25833;
    const scale = pixelRatio / resolution;
    const w = (maxX - minX) * scale;
    const h = (maxY - minY) * scale;
    if (!(w > 0) || !(h > 0)) return out;
    // Smoothing stays on both ways, unlike the ground overlay's: the source is
    // line art, so the only step to preserve would be its aliasing.
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

const addEntry = (spec: SketchOverlay, shown: boolean): Entry => {
  const entry: Entry = {
    spec,
    // Assigned below: the source needs the entry and the entry needs the layer.
    layer: null as unknown as ImageLayer<ImageCanvasSource>,
    out: null,
    render: null,
    renderedScale: null,
    pendingScale: null,
    generation: 0,
  };
  entry.layer = new ImageLayer({
    source: new ImageCanvasSource({
      // Fixed, so a view in another projection reprojects.
      projection: 'EPSG:25833',
      canvasFunction: drawEntry(entry),
    }),
    zIndex: Z_INDEX,
    opacity: spec.opacity,
    visible: shown,
    properties: { id: `sketch.overlay.${spec.id}` },
  });
  getDefaultStore().get(mapAtom).addLayer(entry.layer);
  return entry;
};

/** The whole set, declared rather than added one at a time; an entry whose
 * scene is unchanged keeps its export. `shown` is the group toggle: it hides
 * the layers rather than shortening the list. */
export const setSketchOverlays = (
  next: readonly SketchOverlay[],
  shown = true,
) => {
  const map = getDefaultStore().get(mapAtom);
  const wanted = new Set(next.map((spec) => spec.id));
  for (const [id, entry] of entries) {
    if (wanted.has(id)) continue;
    map.removeLayer(entry.layer);
    entries.delete(id);
  }
  for (const spec of next) {
    if (spec.elements.length === 0) continue;
    const existing = entries.get(spec.id);
    if (!existing) {
      entries.set(spec.id, addEntry(spec, shown));
      continue;
    }
    // Applied before the scene comparison and without touching `generation`:
    // fading or hiding must not throw away an export.
    existing.layer.setOpacity(spec.opacity);
    existing.layer.setVisible(shown);
    if (
      existing.spec.elements === spec.elements &&
      existing.spec.frame === spec.frame
    ) {
      continue;
    }
    existing.spec = spec;
    existing.generation += 1;
    existing.render = null;
    existing.renderedScale = null;
    // Leaving the marker set would keep `ensureRender` from queueing this one.
    existing.pendingScale = null;
    existing.layer.getSource()?.changed();
  }
};
