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

/**
 * How far each shown sketch is faded, 0–100, by attachment id. Missing is
 * 100, i.e. as drawn.
 *
 * Percent rather than OpenLayers' 0–1 because every surface that prints a
 * fade prints a percentage, and the one conversion belongs at the boundary
 * (`setSketchOverlays`) rather than in each control. Same reason the ground
 * overlay's two callers hold percent.
 *
 * Beside `sketchShownAtom` for its reason: the layer row reads it to draw the
 * slider, the workspace reads it to declare the set, and neither owns it.
 */
export const sketchOpacityAtom = atom<ReadonlyMap<string, number>>(
  new Map<string, number>(),
);

/**
 * Whether the group is on the map at all — §13.1's label toggle, one level
 * above the per-member switches.
 *
 * Not the same statement as every member being off, which is why it is a flag
 * of its own: switching the group off and on again has to bring back exactly
 * the composition that was up, and the members' own switches are what
 * remember it. It is layer visibility rather than a teardown for the same
 * reason — an entry keeps its export, so the group comes back without
 * re-rendering every scene in it.
 */
export const sketchGroupShownAtom = atom(true);

export type SketchOverlay = {
  /** The attachment the scene came off. Identity for the diff below. */
  id: string;
  frame: FunnFrame;
  elements: readonly SceneElement[];
  /** 0–1, as OpenLayers wants it. */
  opacity: number;
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
  /**
   * Bumped every time the scene is replaced. An export in flight is about the
   * drawing as it was when it started, and the entry it lands on is the same
   * object, so identity alone cannot tell the two apart.
   */
  generation: number;
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
  const generation = entry.generation;
  void renderScene(entry.spec.frame, entry.spec.elements, { scale }).then(
    (render) => {
      // The sketch may have been hidden, or drawn on again, while the export
      // was running; either way this canvas is a picture of a drawing that is
      // not the one on the map, and taking it would pin the old strokes there
      // until the view zoomed far enough to ask for pixels again.
      //
      // `pendingScale` is cleared inside the guard, not before it: a
      // superseded export must not clear the marker a newer one is holding.
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

const addEntry = (spec: SketchOverlay, shown: boolean): Entry => {
  const entry: Entry = {
    spec,
    // Assigned below; the source needs the entry and the entry needs the
    // layer, so one of the two has to be filled in after the fact.
    layer: null as unknown as ImageLayer<ImageCanvasSource>,
    out: null,
    render: null,
    renderedScale: null,
    pendingScale: null,
    generation: 0,
  };
  entry.layer = new ImageLayer({
    source: new ImageCanvasSource({
      // Fixed, like the ground overlay's: a view in another projection gets
      // the image reprojected rather than placed wrong.
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
 *
 * `shown` is the group, not the set: it hides the layers the list declares
 * rather than shortening the list, so [Skisse]'s label toggle costs nothing
 * on the way back. Defaulted, because taking everything down (`[]`) has no
 * opinion about it.
 */
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
    // Both are properties of the *layer*, so they are applied before the scene
    // comparison below and never touch `generation`: fading a sketch or
    // hiding the group must not throw away an export and re-run it.
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
    // Whatever is in flight is now about the previous drawing, and leaving the
    // marker set would keep `ensureRender` from ever queueing this one.
    existing.pendingScale = null;
    existing.layer.getSource()?.changed();
  }
};
