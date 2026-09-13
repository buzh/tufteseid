// The sketches on the map — docs/ui-architecture.md §9.3.
//
// A sketch is a transparent layer over the ground, not a picture of it: the
// strokes are the whole content and what shows through between them is
// whatever ground the reader has chosen. That is the difference between this
// and `groundOverlay.ts`, and it is why the two are separate modules rather
// than a third owner of that one's slot. A ground overlay is an *image of a
// rectangle* and there can only sensibly be one; a sketch is a **set**. Two
// interpretations of the same mound, one traced off the 1937 ortofoto and one
// off the hillshade, shown together over either — that is the analysis the
// feature exists for.
//
// So: N layers, one per shown sketch, all at `zIndex: 2` — the slot the
// deleted OpenLayers draw subsystem vacated (§15). Above the ground overlay
// (1) so a sketch can be read against a pinned bilde, and below the funn layer
// (5) so the formal record stays legible over whatever has been sketched on
// top of it.
//
// **The pixels are made again, never stored and stretched.** Each layer
// re-exports its scene through `funn/render.ts` at the resolution the view is
// actually showing, so zooming into a sketch sharpens it the way zooming into
// the drawing surface did, instead of magnifying a PNG. The stored figure on
// the record is the citable artifact and a different thing (§8.7.4).
//
// Imperative and module-level like `groundOverlay.ts`, for the same reason:
// the redraws are driven by the view, not by React.

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

/*
 * How far the view may drift from the resolution a sketch was exported at
 * before it is exported again.
 *
 * Not 1: `canvasFunction` runs on every frame of a pinch and an export is a
 * full Excalidraw render, so re-exporting on any change at all would queue one
 * per frame. Not 4 either — past about half a zoom level the strokes visibly
 * soften. A factor of 1.4 is a little over half a zoom step in each direction,
 * which means at most one export per zoom notch and none at all for a pan.
 */
const RESCALE_TOLERANCE = 1.4;

/**
 * Which sketches are up, by attachment id.
 *
 * Here rather than with the rail because both ends need it and neither owns
 * it: the card reads it for its toggle state, the workspace reads it to decide
 * what to hand `setSketchOverlays`. A set rather than a slot — see the module
 * comment.
 */
export const sketchShownAtom = atom<ReadonlySet<string>>(new Set<string>());

export type SketchOverlay = {
  /** The attachment the scene came off. Identity for the diff below. */
  id: string;
  frame: FunnFrame;
  elements: readonly SceneElement[];
};

type Entry = {
  spec: SketchOverlay;
  layer: ImageLayer<ImageCanvasSource>;
  /** Reused for the layer's whole life — see `groundOverlay.ts`. */
  out: HTMLCanvasElement | null;
  render: SceneRender | null;
  /** Device pixels per scene unit `render` was made at. */
  renderedScale: number | null;
  /** Non-null while an export is in flight, so only one ever is. */
  pendingScale: number | null;
};

const entries = new Map<string, Entry>();

/*
 * Re-export if the view has moved far enough to matter, and not otherwise.
 *
 * Called from inside `canvasFunction`, which cannot wait for it: the source
 * wants a canvas now. So the first frame after a sketch is shown draws nothing
 * and the export calls `changed()` when it lands, which is one frame of
 * nothing rather than a stalled map. A failed export records the scale anyway,
 * so a scene that will not render is not retried sixty times a second.
 */
const ensureRender = (entry: Entry, scale: number) => {
  if (entry.pendingScale !== null) return;
  const have = entry.renderedScale;
  if (have !== null && scale < have * RESCALE_TOLERANCE && scale * RESCALE_TOLERANCE > have) {
    return;
  }
  entry.pendingScale = scale;
  void renderScene(entry.spec.frame, entry.spec.elements, { scale }).then(
    (render) => {
      entry.pendingScale = null;
      // The sketch may have been hidden, or its scene replaced, while the
      // export was running; either way this entry is no longer the one on the
      // map and its canvas belongs nowhere.
      if (entries.get(entry.spec.id) !== entry) return;
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

    // Metres per scene unit ÷ metres per device pixel.
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
    // Smoothing stays on in both directions, unlike the ground overlay's. That
    // one turns it off on upscale to keep a single-pixel step in the terrain
    // from being blurred away; here the source is line art drawn at whatever
    // resolution and the step is nothing but the export's own aliasing.
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

const addEntry = (spec: SketchOverlay): Entry => {
  const entry: Entry = {
    spec,
    // Assigned below; the source needs the entry and the entry needs the
    // layer, so one of the two has to be filled in after the fact.
    layer: null as unknown as ImageLayer<ImageCanvasSource>,
    out: null,
    render: null,
    renderedScale: null,
    pendingScale: null,
  };
  entry.layer = new ImageLayer({
    source: new ImageCanvasSource({
      // Fixed, like the ground overlay's: a view in another projection gets
      // the image reprojected rather than placed wrong.
      projection: 'EPSG:25833',
      canvasFunction: drawEntry(entry),
    }),
    zIndex: Z_INDEX,
    properties: { id: `sketch.overlay.${spec.id}` },
  });
  getDefaultStore().get(mapAtom).addLayer(entry.layer);
  return entry;
};

/**
 * The whole set, declared rather than added and removed one at a time.
 *
 * A caller that has to remember which sketches it already put up is a caller
 * that will eventually disagree with the map — closing a lokalitet, switching
 * to another, and hiding a card are three paths to the same state and only one
 * of them is a removal. Pass `[]` to take them all down.
 *
 * An entry whose scene is unchanged keeps its export; a resumed sketch that
 * has just been saved arrives with new elements and re-exports at the
 * resolution it is already being shown at.
 */
export const setSketchOverlays = (next: readonly SketchOverlay[]) => {
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
      entries.set(spec.id, addEntry(spec));
      continue;
    }
    if (
      existing.spec.elements === spec.elements &&
      existing.spec.frame === spec.frame
    ) {
      continue;
    }
    existing.spec = spec;
    existing.render = null;
    existing.renderedScale = null;
    existing.layer.getSource()?.changed();
  }
};
