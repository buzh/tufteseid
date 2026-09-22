import { atom, type Getter, getDefaultStore, type Setter } from 'jotai';
import { atomEffect } from 'jotai-effect';
import { mapAtom } from '../atoms';
import { BackgroundLayerName } from '../layers/backgroundLayers';
import {
  backgroundLayerHalves,
  hybridContoursHalves,
  hybridOverlayHalves,
} from '../layers/config/backgroundLayers/atoms';
import { activeCvatAcquisitionHalves } from '../layers/config/backgroundLayers/cvatGround';
import { activeFlyfotoProjectHalves } from '../layers/config/backgroundLayers/flyfotoBackground';
import {
  isKartVariant,
  kartVariantHalves,
} from '../layers/config/backgroundLayers/kartVariants';
import { lidarAutoDatasetHalves } from '../layers/config/backgroundLayers/lidarAuto';
import {
  activeLidarModelHalves,
  activeLidarProjectHalves,
  activeLidarStyleHalves,
  DEFAULT_LIDAR_PROJECT_STYLE,
  effectiveLidarStyle,
} from '../layers/config/backgroundLayers/lidarProjects';
import {
  buildStack,
  resolveStack,
} from '../layers/config/backgroundLayers/stack';
import {
  clearCompareLayers,
  clearCompareLayersExcept,
  compareHostFor,
  installCompareLayers,
} from './compareLayers';
import { seedHalfB, type ViewMode, viewModeAtom } from './halves';

// Two grounds at once — the same view read twice. The ordinary background stack
// is the A half and keeps the left of the screen; a second stack built by the
// same rules is the B half. Which shape that takes is `viewModeAtom`
// (`halves.ts`); what it costs is why neither shape is persisted to the URL, on
// a rate limit this deployment shares across every visitor. Neither is the flat
// doubling this comment used to claim: B is culled to what it shows in both
// shapes, so the cost is a second stack's worth of layers and queue pressure
// rather than a second viewport's worth of tiles.

/** Where the curtain edge sits, as a fraction of the map width. */
export const compareSplitAtom = atom(0.5);

// What B opens on. The two grounds this app exists to read against each other
// are relief and cartography, so B is whichever of those A is not; ortofoto is
// a ground the reader asks for rather than one a second pane guesses at.
const contrastingGround = (a: BackgroundLayerName): 'kart' | 'lidar' =>
  isKartVariant(a) ? 'lidar' : 'kart';

// The arms' own entry rules again, because seeding B happens before React
// re-renders with the second ground section mounted.
const enterGroundB = (ground: 'kart' | 'lidar', get: Getter, set: Setter) => {
  // Whichever cartography this half was last set to, not necessarily topo.
  if (ground === 'kart') {
    set(backgroundLayerHalves.b, get(kartVariantHalves.b));
    return;
  }
  // `enterLidar` with Automatisk off, which is what B has just been pinned to:
  // the national mosaic, not the held flight. A held flight is wherever the
  // reader last looked at one — `chooseAutoDataset` leaves it there after a
  // move to the mosaic or to another ground — so it need not cover this screen,
  // and with the pin set nothing would re-rank it. The mosaic covers the
  // country, and B's own dataset menu is right there for a flight.
  set(activeLidarStyleHalves.b, DEFAULT_LIDAR_PROJECT_STYLE);
  set(backgroundLayerHalves.b, 'lidarHillshade');
};

/**
 * Pick a view. B starts as a copy of A and is then moved off it, so the only
 * difference is the comparison itself — and only on the way out of `single`:
 * moving between the curtain and the split keeps B where the reader put it.
 */
export const selectViewModeAtom = atom(
  null,
  (get, set, mode: ViewMode) => {
    const previous = get(viewModeAtom);
    if (mode === previous) return;
    if (previous === 'single' && mode !== 'single') {
      seedHalfB(get, set);
      // A comparison term that follows the viewport is not a comparison term.
      set(lidarAutoDatasetHalves.b, false);
      enterGroundB(contrastingGround(get(backgroundLayerHalves.a)), get, set);
    }
    set(viewModeAtom, mode);
  },
);

// The build awaits, and an earlier run resolving last would install a stack the
// user has already changed.
let compareGeneration = 0;

export const compareLayerAtomEffect = atomEffect((get) => {
  const mode = get(viewModeAtom);
  // The B half throughout, mirroring backgroundLayerAtomEffect's A half.
  const layerName = get(backgroundLayerHalves.b);
  const hybridOverlay = get(hybridOverlayHalves.b);
  const hybridContours = get(hybridContoursHalves.b);
  const lidarProject = get(activeLidarProjectHalves.b);
  const lidarStyle = get(activeLidarStyleHalves.b);
  const lidarModel = get(activeLidarModelHalves.b);
  const flyfotoProject = get(activeFlyfotoProjectHalves.b);
  const cvatAcquisition = get(activeCvatAcquisitionHalves.b);

  const generation = ++compareGeneration;

  // 'empty' is not offered as a choice but is reachable from ?backgroundLayer.
  if (mode === 'single' || layerName === 'empty') {
    clearCompareLayers();
    return;
  }

  // One decision, made here and carried through the build: which map the stack
  // goes into, and whether it is clipped. The map it is *not* going into is
  // swept on the spot rather than by the install, because every way the build
  // below can end without installing — an unresolvable stack, a rejected fetch,
  // a superseded generation — would otherwise leave the host of a view nobody
  // is looking at still drawing.
  const host = compareHostFor(mode);
  clearCompareLayersExcept(host);
  const clip = mode === 'curtain';

  const stack = resolveStack(layerName, {
    lidarProject,
    cvatAcquisition,
    lidarStyle: effectiveLidarStyle(lidarStyle, lidarModel),
    lidarModel,
    flyfotoProject,
    hybridOverlay,
    hybridContours,
  });
  if (!stack) return;

  const install = async () => {
    try {
      const projection = getDefaultStore()
        .get(mapAtom)
        .getView()
        .getProjection()
        .getCode();
      const built = await buildStack(stack, projection, 'cmp', host);
      if (generation !== compareGeneration) return;
      if (!built) return;

      for (const { layer, opacity } of [...built.under, ...built.over]) {
        layer.setOpacity(opacity);
      }
      installCompareLayers(
        built.under.map((e) => e.layer),
        built.over.map((e) => e.layer),
        { host, clip },
      );
    } catch (error) {
      console.error('[compare] failed to build the B stack', error);
    }
  };

  install();
});
