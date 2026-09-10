import { getDefaultStore } from 'jotai';
import type BaseLayer from 'ol/layer/Base';
import type TileLayer from 'ol/layer/Tile';
import { getRenderPixel } from 'ol/render';
import type RenderEvent from 'ol/render/Event';
import { mapAtom } from '../atoms';

/*
 * The B half of the compare curtain, on the map.
 *
 * Imperative and module-level, like swapBackgroundLayers and the terrain
 * overlay: the clip rectangle moves with every pointer frame of a drag and
 * no React component needs to see that.
 *
 * Two things keep this out of the ordinary background machinery's way. The
 * layer ids carry a `cmp.` prefix, and `isBackgroundLayer` is a strict
 * `startsWith('bg.')`, so a background swap never sweeps a curtain layer up
 * as collateral. And the reuse signature is namespaced too, so A and B never
 * end up handed the same layer instance — which would put it in the map
 * twice and clip the half that isn't B's.
 */

// Above the background stack (0) and the terrain render (1) — Terreng on the
// left against a photograph on the right is one of the comparisons worth
// making — and below everything drawn on top of the ground: the draw layer
// (2), measure (3), the lokalitet rectangles (4), funn (5). Marks have to
// stay drawn across the divider; a funn that disappears when you drag the
// curtain over it is exactly the thing you opened compare to look at.
//
// Fractional like funnHighlightLayer's 4.5, for the same reason: the ladder
// is a fixed set of integers and this belongs between two of them.
export const COMPARE_Z = 1.5;

const CMP_PREFIX = 'cmp.';

// Where the curtain edge is, as a fraction of the map's width from the left.
// Read inside the render handlers rather than passed in: OL calls them, not
// us.
let split = 0.5;

const isCompareLayer = (layer: BaseLayer): boolean =>
  String(layer.get('id') ?? '').startsWith(CMP_PREFIX);

const getMap = () => getDefaultStore().get(mapAtom);

// `getRenderPixel` rather than raw canvas coordinates: the context handed to
// a render handler is in device pixels and carries whatever transform OL is
// mid-frame with (during an animated zoom that is not identity). Translating
// the four corners through it is the only way the clip lands where the CSS
// divider is.
const clipToRightOfSplit = (e: RenderEvent) => {
  const ctx = e.context;
  if (!ctx) return;
  const size = getMap().getSize();
  if (!size) return;
  const [w, h] = size;
  const x = w * split;
  const tl = getRenderPixel(e, [x, 0]);
  const tr = getRenderPixel(e, [w, 0]);
  const br = getRenderPixel(e, [w, h]);
  const bl = getRenderPixel(e, [x, h]);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(tl[0], tl[1]);
  ctx.lineTo(tr[0], tr[1]);
  ctx.lineTo(br[0], br[1]);
  ctx.lineTo(bl[0], bl[1]);
  ctx.closePath();
  ctx.clip();
};

const unclip = (e: RenderEvent) => e.context?.restore();

const attachClip = (layer: TileLayer) => {
  // Layers survive across installs when the resolved stack is unchanged, and
  // a second pair of handlers would save/clip/restore twice per frame.
  if (layer.get('cmpClip')) return;
  layer.set('cmpClip', true);
  layer.on('prerender', clipToRightOfSplit);
  layer.on('postrender', unclip);
};

/**
 * Put this stack on the map as the B half, bottom-first, and take down
 * whatever the previous B half was.
 *
 * Every layer gets the same zIndex; OL breaks ties by collection order, and
 * because the whole set is removed and re-added together that order is
 * exactly the one passed in.
 */
export const installCompareLayers = (layers: TileLayer[]) => {
  const map = getMap();
  const collection = map.getLayers();
  for (const layer of collection.getArray().slice()) {
    if (isCompareLayer(layer) && !layers.includes(layer as TileLayer)) {
      map.removeLayer(layer);
    }
  }
  for (const layer of layers) {
    attachClip(layer);
    layer.setZIndex(COMPARE_Z);
    collection.remove(layer);
    collection.push(layer);
  }
};

export const clearCompareLayers = () => {
  const map = getMap();
  for (const layer of map.getLayers().getArray().slice()) {
    if (isCompareLayer(layer)) map.removeLayer(layer);
  }
};

/** Move the curtain edge. Cheap enough to call on every pointer frame. */
export const setCurtainSplit = (fraction: number) => {
  split = fraction;
  getMap().render();
};
