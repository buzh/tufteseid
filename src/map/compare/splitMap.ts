import { getDefaultStore } from 'jotai';
import { defaults as defaultControls } from 'ol/control';
import { defaults as defaultInteractions } from 'ol/interaction';
import OlMap from 'ol/Map';
import { mapAtom } from '../atoms';

// The right pane of the split view: a second OpenLayers map sharing the main
// map's `View`, so the two are centred and scaled identically by construction.
// `Map#updateSize` writes its own viewport size into the shared view, so the
// last map to resize wins; harmless only while the panes are the same width and
// nothing constrains the extent.

let splitMap: OlMap | null = null;

/** The right pane's map, made on first ask. */
export const getSplitMap = (): OlMap => {
  if (splitMap) return splitMap;
  const main = getDefaultStore().get(mapAtom);
  splitMap = new OlMap({
    // Attribution kept: this pane draws a ground the other does not, and some
    // of the services behind it are licensed on being credited where shown.
    controls: defaultControls({ zoom: false, rotate: false }),
    // Keyboard off: the main map listens on `document`, so with both armed an
    // arrow key pans the shared view twice.
    interactions: defaultInteractions({
      altShiftDragRotate: false,
      pinchRotate: false,
      keyboard: false,
    }),
    // Its own queue, sized like the main map's (map/atoms.ts).
    maxTilesLoading: 48,
    view: main.getView(),
  });
  return splitMap;
};

/** The right pane's map if it has ever been opened, and null otherwise. */
export const peekSplitMap = (): OlMap | null => splitMap;
