import { atom, getDefaultStore } from 'jotai';
import { atomEffect } from 'jotai-effect';
import TileLayer from 'ol/layer/Tile';
import {
  getUrlParameter,
  removeUrlParameter,
  setUrlParameter,
} from '../../../../shared/utils/urlUtils';
import { mapAtom } from '../../../atoms';
import { BackgroundLayerName, WMTSLayerName } from '../../backgroundLayers';
import { buildNationalLidarConfig } from './elevation';
import {
  activeFlyfotoProjectAtom,
  buildFlyfotoProjectConfig,
  FLYFOTO_MOSAIC_CONFIG,
} from './flyfotoBackground';
import { KvCacheBackgroundLayers } from './kvCache';
import {
  activeLidarModelAtom,
  activeLidarProjectAtom,
  activeLidarStyleAtom,
  DEFAULT_LIDAR_PROJECT_STYLE,
  effectiveLidarStyle,
  LidarModel,
  LidarProject,
  LIDAR_PROJECT_WMS_URL,
} from './lidarProjects';
import {
  BackgroundLayer,
  EmptyBackgroundLayer,
  WMSBackgroundLayer,
} from './types';
import { TOPO_OVERLAY_CONFIG } from './topoOverlay';
import {
  buildOrReuseBackgroundLayer,
  clearBackgroundLayer,
  swapBackgroundLayers,
} from './utils';

// Kartverket's LiDAR WMS layers return transparent PNGs outside their
// coverage areas (both wms.hoyde-dtm-nhm-topobathy-25833 and per-project
// wms.hoyde-dtm-prosjekt behave this way). Rendering them on top of the
// topo WMTS layer means the topo shines through the transparent tiles,
// so the user still has geographic context outside the LiDAR footprint
// instead of an empty grey canvas. A single ortofoto acquisition behaves
// the same way (see the jpgpng note in flyfotoBackground.ts) and covers
// even less of the screen, so it wants the same treatment.
//
// The seamless ortofoto mosaic is *not* in here: it is opaque JPEG across
// its whole advertised extent, so a base under it would be invisible and
// still cost a screenful of requests.
const NEEDS_TOPO_BASE = new Set<BackgroundLayerName>([
  'lidarProject',
  'lidarHillshade',
  'flyfotoProject',
]);

// Which layers the LiDAR modifiers mean anything for. Deliberately not
// NEEDS_TOPO_BASE, which flyfotoProject now also belongs to: hybrid's
// roads-and-names overlay and the DTM/DOM choice are decisions about the
// LiDAR stack, and writing ?lidarModel=dom while looking at a 1937
// photograph would be a lie about what's on screen.
const LIDAR_LAYERS = new Set<BackgroundLayerName>([
  'lidarProject',
  'lidarHillshade',
]);

// How far the layer underneath is dimmed when it's playing backdrop to a
// per-project dataset: strong enough to read outside the project's
// footprint, weak enough that the project is obviously the layer in focus.
// For LiDAR the topo base still sits under the faded national mosaic, so
// the uncovered area also picks up a green cast — which turns out to be
// useful, the coverage edge reads as a change in hue as well as in
// contrast. Turn this up towards 1 if the blend is too soft to read.
const FALLBACK_OPACITY = 0.6;

const emptyBackgroundLayer: EmptyBackgroundLayer = {
  type: 'Empty',
  layerName: 'empty',
};

// 'lidarHillshade' (national mosaic), 'lidarProject', 'flyfoto' and
// 'flyfotoProject' are all handled as dynamic branches in
// backgroundLayerAtomEffect below — their style or their acquisition comes
// out of an atom, so none of them has a static entry here.
export const allConfiguredBackgroundLayers = [
  emptyBackgroundLayer,
  ...KvCacheBackgroundLayers,
];

// Startup values the URL param may name directly. `lidarProject` and
// `flyfotoProject` are excluded because their concrete acquisition lives in
// an atom that starts null on a fresh visit — leaving the app on either one
// with nothing selected renders nothing.
const VALID_STARTUP_LAYERS = new Set<BackgroundLayerName>([
  'topo',
  'lidarHillshade',
  'flyfoto',
  'empty',
]);

const getDefaultBackgroundLayer = (): BackgroundLayerName => {
  const layerNameFromUrl = getUrlParameter(
    'backgroundLayer',
  ) as BackgroundLayerName | null;
  if (layerNameFromUrl && VALID_STARTUP_LAYERS.has(layerNameFromUrl)) {
    return layerNameFromUrl;
  }
  return 'topo';
};

export const backgroundLayerCapabilitiesCacheAtom = atom<
  Partial<Record<WMTSLayerName, string>>
>({});

export const backgroundLayerAtom = atom<BackgroundLayerName>(
  getDefaultBackgroundLayer(),
);

// Hybrid mode: the LiDAR relief with Kartverket's transparent
// roads/railways/place-names overlay on top, so you can tell what
// you're looking at without leaving the terrain. A modifier on the
// background rather than a background of its own — it only has meaning
// over a LiDAR layer, and toggling it doesn't disturb which dataset or
// style is selected underneath.
export const hybridOverlayAtom = atom<boolean>(
  getUrlParameter('hybrid') === 'true',
);

const buildLidarProjectConfig = (
  project: LidarProject,
  style: string,
  model: LidarModel,
): WMSBackgroundLayer => ({
  type: 'WMS',
  layerName: 'lidarProject',
  url: LIDAR_PROJECT_WMS_URL[model],
  props: {
    LAYERS: `${project.id}:${style}`,
    VERSION: '1.3.0',
  },
  // The acquisition's own footprint, not the service's. A single
  // project covers a county at most, while wms.hoyde-dtm-prosjekt
  // advertises the union of all 1936 of them (Jan Mayen to Svalbard) —
  // so the per-project bbox culls far more of the pointless renders.
  coverageExtent: { extent: project.bboxLonLat, crs: 'EPSG:4326' },
});

// Which run of the effect below is the current one. The effect builds
// its stack asynchronously — a WMTS base still needs its capabilities
// fetched the first time — while W/S and A/D fire the effect faster than
// that round trip. Without this an earlier run could resolve last and
// install a stack the user has already cycled past, along with its URL
// parameters. Bumped before any of the early returns so switching to the
// empty background invalidates an in-flight build too.
let swapGeneration = 0;

export const backgroundLayerAtomEffect = atomEffect((get) => {
  const generation = ++swapGeneration;
  const layerName = get(backgroundLayerAtom);
  // Depend on the active lidar project + style so switching either while
  // a LiDAR layer is the background rebuilds the WMS layer.
  const activeLidarProject = get(activeLidarProjectAtom);
  const activeLidarStyle = get(activeLidarStyleAtom);
  const activeLidarModel = get(activeLidarModelAtom);
  // Same for the flyfoto acquisition: picking another year while
  // 'flyfotoProject' is the background rebuilds its mosaicRule.
  const activeFlyfotoProject = get(activeFlyfotoProjectAtom);
  const hybridOverlay = get(hybridOverlayAtom);
  // DOM publishes one style, so the model has the last word — and the
  // user's DTM pick stays in the atom, waiting for them to switch back.
  const lidarStyle = effectiveLidarStyle(activeLidarStyle, activeLidarModel);

  if (layerName === 'empty') {
    clearBackgroundLayer();
    setUrlParameter('backgroundLayer', 'empty');
    return;
  }

  // The four dynamic layers are built here from the atoms above; everything
  // else is a static entry looked up by name.
  const pickLayerConfig = (): BackgroundLayer | undefined => {
    switch (layerName) {
      case 'lidarProject':
        return activeLidarProject
          ? buildLidarProjectConfig(
              activeLidarProject,
              lidarStyle,
              activeLidarModel,
            )
          : undefined;
      case 'lidarHillshade':
        return buildNationalLidarConfig(lidarStyle, activeLidarModel);
      case 'flyfoto':
        return FLYFOTO_MOSAIC_CONFIG;
      case 'flyfotoProject':
        return activeFlyfotoProject
          ? buildFlyfotoProjectConfig(activeFlyfotoProject)
          : undefined;
      default:
        return allConfiguredBackgroundLayers.find(
          (l) => l.layerName === layerName,
        );
    }
  };

  const layerConfig = pickLayerConfig();

  if (!layerConfig) {
    if (layerName === 'lidarProject' || layerName === 'flyfotoProject') {
      // Nothing picked out of the archive yet — nothing to render, and
      // nothing wrong either, so no warning.
      return;
    }
    console.warn(`No layer config found for layer name: ${layerName}`);
    return;
  }

  const effect = async () => {
    try {
      const store = getDefaultStore();
      const map = store.get(mapAtom);
      const projection = map.getView().getProjection().getCode();

      // Everything the requested layer sits on top of, built in parallel
      // with it — cheaper than sequentially, and it keeps the swap atomic
      // (the whole stack is ready before swapBackgroundLayers runs).
      const baseTopoConfig = NEEDS_TOPO_BASE.has(layerName)
        ? allConfiguredBackgroundLayers.find((l) => l.layerName === 'topo')
        : undefined;

      // A per-project dataset typically covers a fraction of the screen.
      // Dropping to topo outside its footprint reads as "the terrain
      // stopped", and while cycling projects it's the loudest thing on
      // screen. The seamless national product underneath instead keeps
      // coverage everywhere, and faded it stays clearly subordinate to the
      // project — the coverage edge is the contrast step, not a switch
      // to a different kind of map. For LiDAR that's the national mosaic,
      // fixed to its own style (it publishes skyggerelieff and nothing
      // else); for one ortofoto acquisition it's the best-available
      // ortofoto mosaic, i.e. the same ground photographed recently.
      const fallbackConfig =
        layerName === 'lidarProject'
          ? buildNationalLidarConfig(
              DEFAULT_LIDAR_PROJECT_STYLE,
              activeLidarModel,
            )
          : layerName === 'flyfotoProject'
            ? FLYFOTO_MOSAIC_CONFIG
            : undefined;

      // Only meaningful over terrain — on the plain topo map it would
      // just redraw roads and names the base already has.
      const overlayConfig =
        hybridOverlay && LIDAR_LAYERS.has(layerName)
          ? TOPO_OVERLAY_CONFIG
          : undefined;

      const [baseLayer, fallbackLayer, topLayer, overlayLayer] =
        await Promise.all([
          baseTopoConfig
            ? buildOrReuseBackgroundLayer(baseTopoConfig, projection)
            : Promise.resolve(null),
          fallbackConfig
            ? buildOrReuseBackgroundLayer(fallbackConfig, projection)
            : Promise.resolve(null),
          buildOrReuseBackgroundLayer(layerConfig, projection),
          overlayConfig
            ? buildOrReuseBackgroundLayer(overlayConfig, projection)
            : Promise.resolve(null),
        ]);

      // A newer run started while this one was building. Everything from
      // here on mutates shared state — the layer collection, the URL —
      // so it has to be the last word or not happen at all.
      if (generation !== swapGeneration) return;

      if (!topLayer) return;

      // Always set opacity explicitly: any of these may be a reused
      // layer still carrying the fade from an earlier swap.
      baseLayer?.setOpacity(1);
      fallbackLayer?.setOpacity(FALLBACK_OPACITY);
      topLayer.setOpacity(1);
      overlayLayer?.setOpacity(1);

      const notNull = (l: TileLayer | null): l is TileLayer => l != null;
      swapBackgroundLayers(
        [baseLayer, fallbackLayer].filter(notNull),
        [topLayer, overlayLayer].filter(notNull),
      );
      setUrlParameter('backgroundLayer', layerName);
      // Keyed on what's actually in the stack, not on the atoms: a
      // shared URL should reproduce what's on screen.
      if (overlayConfig) setUrlParameter('hybrid', true);
      else removeUrlParameter('hybrid');
      if (LIDAR_LAYERS.has(layerName) && activeLidarModel === 'dom') {
        setUrlParameter('lidarModel', 'dom');
      } else {
        removeUrlParameter('lidarModel');
      }

      if (layerConfig.moveToExtent) {
        map.getView().fit(layerConfig.moveToExtent, { duration: 200 });
      }
    } catch (error) {
      console.error(
        `Error fetching capabilities for layer ${layerName}:`,
        error,
      );
    }
  };

  effect();
});
