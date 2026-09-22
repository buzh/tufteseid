import { getDefaultStore } from 'jotai';
import { defaults as defaultInteractions } from 'ol/interaction';
import OlMap from 'ol/Map';
import { mapAtom } from '../atoms';

// The right pane of the split view: a second OpenLayers map that shares the
// first one's `View` object.
//
// That sharing is the whole mechanism. Two maps on one view have the same
// centre, the same resolution and the same projection at every instant, and
// each renders it into its own half-width viewport — so the point under the
// middle of the left pane is the point under the middle of the right one, which
// is what the split view is for. Dragging either pane moves the view, so the
// other follows without anything synchronising them.
//
// The alternative was one map with the B stack translated at paint time, which
// is what the curtain already does minus the offset. It was rejected because
// the translation would be invisible to everything that is not a raster: hit
// testing, the Kulturminner cards, the footprint outlines and the terrain frame
// all read pixels off the map's own transform, and every one of them would have
// pointed at the wrong ground on the right-hand side.
//
// One thing the sharing does cost: `Map#updateSize` writes its own viewport
// size into the view, so with two maps the last to resize wins. It is harmless
// here because the size is only read to fit a constrained extent, and this app
// constrains none — and because the two panes are the same width anyway.
//
// Lazy, and a module singleton rather than an atom: `peekSplitMap` has to be
// able to answer "is there one" without creating one, because the tile guard
// and the theme-layer effect walk whatever maps exist and must not conjure a
// second map on an install that has never opened the split view.

let splitMap: OlMap | null = null;

/** The right pane's map, made on first ask. */
export const getSplitMap = (): OlMap => {
  if (splitMap) return splitMap;
  const main = getDefaultStore().get(mapAtom);
  splitMap = new OlMap({
    // One scale line for the pair: the two panes share a resolution, so a
    // second copy of it would say the same thing twice.
    controls: [],
    // Keyboard off, unlike the main map. That one listens on `document`, so
    // with both of them armed an arrow key would pan the shared view twice.
    interactions: defaultInteractions({
      altShiftDragRotate: false,
      pinchRotate: false,
      keyboard: false,
    }),
    // Its own queue, sized like the main map's for the same reason (map/atoms.ts).
    maxTilesLoading: 48,
    // The shared view. Not a copy: a copy would need synchronising, and a
    // synchroniser is a thing that can drift.
    view: main.getView(),
  });
  return splitMap;
};

/** The right pane's map if it has ever been opened, and null otherwise. */
export const peekSplitMap = (): OlMap | null => splitMap;
