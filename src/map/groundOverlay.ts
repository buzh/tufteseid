// One georeferenced image over the background, and the arbiter for who owns
// it.
//
// This started as terrainOverlayLayer.ts, which existed so a terrain render
// could be read *against* everything else on the map — the Kulturminner
// layers, a lokalitet's rectangle, the funn drawn on it — instead of being
// letterboxed into a thumbnail. A kept bilde wants exactly the same thing and
// for exactly the same reason (docs/lokalitet-view.md §4.2): the owner's 1937
// ortofoto faded over the reader's live hillshade, in register, with the funn
// on top, is the thing the app is for.
//
// So both are "an image of this rectangle" at `zIndex: 1`, and **there is one
// slot**. Two of them stacked is a question nobody asked, and two modules
// racing for the same zIndex is worse: whichever added its layer last wins,
// silently, depending on mount order. Hence one module, one layer, one
// `current`, and an owner tag on it. Showing a bilde stands the terrain render
// down; entering Terreng unpins the bilde. Whoever is displaced hears about it
// through `subscribeGroundOverlay` and updates its own controls, rather than
// finding out by not being on screen.
//
// Imperative and module-level, like `swapBackgroundLayers`, rather than an
// atom plus a hook. Two of the three things that change here — the pixels on
// every slider frame, the opacity on every drag of its own — change dozens of
// times a second and no React component needs to see either. Routing them
// through jotai would re-render the whole shell at that rate for nothing.
// Only the *owner* is published, because that changes once per user action.

import { getDefaultStore } from 'jotai';
import type { Extent } from 'ol/extent';
import ImageLayer from 'ol/layer/Image';
import type { Size } from 'ol/size';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import { mapAtom } from './atoms';

const LAYER_ID = 'ground.overlay';

// Over the background stack, which sets no zIndex at all (i.e. 0), and under
// everything drawn on top of it: the lokalitet rectangles (4), the funn (5)
// and the theme layers (10). Putting the heritage record on top of the relief
// is the whole point, so the relief has to be the ground.
const Z_INDEX = 1;

/**
 * Terrenganalyse's live render, or a bilde pinned to the rectangle it is of.
 * Never both — see the module comment.
 */
export type GroundOverlayOwner = 'terrain' | 'bilde';

export type GroundOverlay = {
  owner: GroundOverlayOwner;
  /**
   * What to paint. Terrain hands over *the same canvas* it paints into and
   * nothing is copied, so repaints land in place and the source has no way of
   * noticing its cached image went stale — which is why `showGroundOverlay` is
   * also the repaint call. A bilde hands over a decoded `<img>`.
   */
  source: HTMLCanvasElement | HTMLImageElement;
  /**
   * The part of `source` that is ground, in its own pixels. The whole canvas
   * for a terrain render; for a bilde, `meta.imageRect` scaled to whichever
   * rendition actually loaded — a figure PNG carries its caption panel below
   * the image, so the file is not pixel-registered to the extent.
   */
  crop: { x: number; y: number; width: number; height: number };
  /** EPSG:25833. The ground `crop` covers, edge to edge. */
  extent25833: [number, number, number, number];
};

let layer: ImageLayer<ImageCanvasSource> | null = null;
let current: GroundOverlay | null = null;

// Remembered per owner and deliberately outliving the layer: switching
// DTM→DOM tears the layer down and rebuilds it, and losing the fade you had
// just dialled in on the way through would be a bug. Each owner pushes its
// own value when it takes the slot, so neither inherits the other's.
const opacityByOwner: Record<GroundOverlayOwner, number> = {
  terrain: 1,
  bilde: 1,
};

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

// One output canvas for the layer's whole life rather than one per call.
// ImageCanvasSource explicitly supports a reused element — that is what
// `changed()` is for — and the alternative is allocating a viewport-sized
// canvas (30 MB on a 4K display at devicePixelRatio 2) on every frame of a
// slider drag.
let out: HTMLCanvasElement | null = null;

const drawFrame = (
  extent: Extent,
  resolution: number,
  pixelRatio: number,
  size: Size,
): HTMLCanvasElement => {
  out ??= document.createElement('canvas');
  const width = Math.round(size[0]);
  const height = Math.round(size[1]);
  if (out.width !== width || out.height !== height) {
    out.width = width;
    out.height = height;
  }
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  ctx.clearRect(0, 0, width, height);
  if (!current) return out;

  const [minX, minY, maxX, maxY] = current.extent25833;
  // Ground metres → canvas pixels.
  const scale = pixelRatio / resolution;
  const w = (maxX - minX) * scale;
  const h = (maxY - minY) * scale;
  const { x, y, width: cw, height: ch } = current.crop;
  if (cw <= 0 || ch <= 0) return out;
  // Nearest-neighbour once a source pixel is larger than a screen pixel:
  // smoothing on upscale blurs away precisely the single-pixel step — a ditch
  // edge, the lip of a mound — that the image exists to show. On downscale it
  // is the other way round and averaging helps.
  ctx.imageSmoothingEnabled = w < cw;
  ctx.drawImage(
    current.source,
    x,
    y,
    cw,
    ch,
    (minX - extent[0]) * scale,
    (extent[3] - maxY) * scale,
    w,
    h,
  );
  return out;
};

/**
 * Take the slot, move what is in it to a new rectangle, or announce that its
 * pixels changed under us — all three are the same call, because the source
 * caches one image and `changed()` is the only way to invalidate it. Building
 * the layer once and re-asking it for its image is also what keeps re-framing
 * and every slider frame from flashing.
 *
 * Calling it with the other owner is how the hand-over happens. There is no
 * "take it away from them first" step on purpose: an arbiter with two verbs is
 * an arbiter two callers can disagree with.
 */
export const showGroundOverlay = (next: GroundOverlay) => {
  const previousOwner = current?.owner ?? null;
  current = next;
  if (!layer) {
    layer = new ImageLayer({
      source: new ImageCanvasSource({
        // Fixed, so a view in any of the app's other projections gets the
        // image reprojected rather than placed wrong.
        projection: 'EPSG:25833',
        canvasFunction: drawFrame,
      }),
      zIndex: Z_INDEX,
      opacity: opacityByOwner[next.owner],
      properties: { id: LAYER_ID },
    });
    getDefaultStore().get(mapAtom).addLayer(layer);
  } else {
    if (previousOwner !== next.owner) {
      layer.setOpacity(opacityByOwner[next.owner]);
    }
    layer.getSource()?.changed();
  }
  if (previousOwner !== next.owner) notify();
};

/** 0..1. Fades the image towards whatever it is covering. */
export const setGroundOverlayOpacity = (
  owner: GroundOverlayOwner,
  value: number,
) => {
  opacityByOwner[owner] = value;
  if (current?.owner === owner) layer?.setOpacity(value);
};

/**
 * Put the slot down — but only if you still hold it. The no-op case is the
 * point: an owner that was displaced a moment ago still runs its own cleanup,
 * and without this check that cleanup would remove the *other* owner's image.
 */
export const hideGroundOverlay = (owner: GroundOverlayOwner) => {
  if (current?.owner !== owner) return;
  if (layer) getDefaultStore().get(mapAtom).removeLayer(layer);
  layer = null;
  current = null;
  out = null;
  notify();
};

export const groundOverlayOwner = (): GroundOverlayOwner | null =>
  current?.owner ?? null;

/** For `useSyncExternalStore`. Fires only when the owner changes. */
export const subscribeGroundOverlay = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
