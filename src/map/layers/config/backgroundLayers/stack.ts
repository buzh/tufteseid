import TileLayer from 'ol/layer/Tile';
import type OlMap from 'ol/Map';
import { BackgroundLayerName } from '../../backgroundLayers';
import { buildCvatGroundConfig, type CvatAcquisition } from './cvatGround';
import { buildNationalLidarConfig } from './elevation';
import {
  buildFlyfotoProjectConfig,
  FLYFOTO_MOSAIC_CONFIG,
} from './flyfotoBackground';
import type { FlyfotoProject } from './flyfotoProjects';
import { AMTSKART_CONFIG } from './kartVariants';
import { KvCacheBackgroundLayers } from './kvCache';
import {
  DEFAULT_LIDAR_PROJECT_STYLE,
  LidarModel,
  LidarProject,
  LIDAR_PROJECT_WMS_URL,
  wmsLidarStyle,
} from './lidarProjects';
import { buildTopoOverlayConfig } from './topoOverlay';
import {
  BackgroundLayer,
  EmptyBackgroundLayer,
  WMSBackgroundLayer,
} from './types';
import { buildOrReuseBackgroundLayer, LayerNamespace } from './utils';

// These answer transparent outside their coverage, so topo shows through.
const NEEDS_TOPO_BASE = new Set<BackgroundLayerName>([
  'lidarProject',
  'lidarHillshade',
  'lidarCvat',
  'flyfotoProject',
  'amtskart',
]);

// Which layers the LiDAR modifiers — hybrid overlay, contours, model — apply
// to.
export const LIDAR_LAYERS = new Set<BackgroundLayerName>([
  'lidarProject',
  'lidarHillshade',
  'lidarCvat',
]);

// How far the layer under a per-project dataset is dimmed.
const FALLBACK_OPACITY = 0.6;

// The hybrid overlay has to clear the cached store's coverage hint at 0.5
// (`cvatHintLayer.ts`). Full z-order register: `docs/map-layers.md`.
const GROUND_Z = 0;
const HYBRID_OVERLAY_Z = 0.75;

// NDH project rasters are 0.25 m at their finest, 0.5 m for most flights; z17
// is 0.166 m/px, one level of magnification past native.
const LIDAR_PROJECT_MAX_ZOOM = 17;

const emptyBackgroundLayer: EmptyBackgroundLayer = {
  type: 'Empty',
  layerName: 'empty',
};

// Only the fixed layers; runtime choices are built by `pickLayerConfig`.
export const allConfiguredBackgroundLayers = [
  emptyBackgroundLayer,
  ...KvCacheBackgroundLayers,
  AMTSKART_CONFIG,
];

const buildLidarProjectConfig = (
  project: LidarProject,
  style: string,
  model: LidarModel,
): WMSBackgroundLayer => ({
  type: 'WMS',
  layerName: 'lidarProject',
  url: LIDAR_PROJECT_WMS_URL[model],
  props: {
    // The WMS answers an unknown style with a blank tile, and `cvat` is a
    // render no service publishes.
    LAYERS: `${project.id}:${wmsLidarStyle(style)}`,
    VERSION: '1.3.0',
  },
  maxZoom: LIDAR_PROJECT_MAX_ZOOM,
  // Capped below the view's depth, so deep views upsample (`types.ts`).
  interpolate: false,
  coverageExtent: { extent: project.bboxLonLat, crs: 'EPSG:4326' },
});

export type StackOptions = {
  lidarProject: LidarProject | null;
  /** Null until the manifest and the catalogue have both landed. */
  cvatAcquisition: CvatAcquisition | null;
  /** Already clamped for the model — see `effectiveLidarStyle`. */
  lidarStyle: string;
  lidarModel: LidarModel;
  flyfotoProject: FlyfotoProject | null;
  hybridOverlay: boolean;
  /** Contour lines on the hybrid overlay. Inert without `hybridOverlay`. */
  hybridContours: boolean;
};

export type StackEntry = {
  config: BackgroundLayer;
  opacity: number;
  zIndex: number;
};

export type ResolvedStack = {
  /** Bottom-first, everything the featured dataset sits on top of. */
  under: StackEntry[];
  /** Bottom-first, and `over[0]` is always the featured dataset itself. */
  over: StackEntry[];
  /** What the URL follows, rather than the atoms: the modifiers only apply over
   *  some grounds. */
  hybrid: boolean;
  contours: boolean;
};

const pickLayerConfig = (
  layerName: BackgroundLayerName,
  opts: StackOptions,
): BackgroundLayer | undefined => {
  switch (layerName) {
    case 'lidarProject':
      return opts.lidarProject
        ? buildLidarProjectConfig(
            opts.lidarProject,
            opts.lidarStyle,
            opts.lidarModel,
          )
        : undefined;
    case 'lidarHillshade':
      return buildNationalLidarConfig(opts.lidarStyle, opts.lidarModel);
    case 'lidarCvat':
      return opts.cvatAcquisition
        ? buildCvatGroundConfig(opts.cvatAcquisition)
        : undefined;
    case 'flyfoto':
      return FLYFOTO_MOSAIC_CONFIG;
    case 'flyfotoProject':
      return opts.flyfotoProject
        ? buildFlyfotoProjectConfig(opts.flyfotoProject)
        : undefined;
    default:
      return allConfiguredBackgroundLayers.find(
        (l) => l.layerName === layerName,
      );
  }
};

// `null` means nothing to draw: an unknown name, or a per-acquisition ground
// with no acquisition picked yet.
export const resolveStack = (
  layerName: BackgroundLayerName,
  opts: StackOptions,
): ResolvedStack | null => {
  const featured = pickLayerConfig(layerName, opts);
  if (!featured) return null;

  const under: StackEntry[] = [];
  if (NEEDS_TOPO_BASE.has(layerName)) {
    const topo = allConfiguredBackgroundLayers.find(
      (l) => l.layerName === 'topo',
    );
    if (topo) under.push({ config: topo, opacity: 1, zIndex: GROUND_Z });
  }

  // The seamless product of the same kind, faded, under a dataset with holes.
  // DTM under the cached ground: it has no model toggle to undo a held DOM.
  const fallback =
    layerName === 'lidarProject'
      ? buildNationalLidarConfig(DEFAULT_LIDAR_PROJECT_STYLE, opts.lidarModel)
      : layerName === 'lidarCvat'
        ? buildNationalLidarConfig(DEFAULT_LIDAR_PROJECT_STYLE, 'dtm')
        : layerName === 'flyfotoProject'
          ? FLYFOTO_MOSAIC_CONFIG
          : null;
  if (fallback) {
    under.push({
      config: fallback,
      opacity: FALLBACK_OPACITY,
      zIndex: GROUND_Z,
    });
  }

  // Only over terrain: on the topo map it redraws the base's roads and names.
  const hybrid = opts.hybridOverlay && LIDAR_LAYERS.has(layerName);
  // Contours ride the overlay's own GetMap, so without it there is nothing.
  const contours = hybrid && opts.hybridContours;
  const over: StackEntry[] = [
    { config: featured, opacity: 1, zIndex: GROUND_Z },
  ];
  if (hybrid) {
    over.push({
      config: buildTopoOverlayConfig(contours),
      opacity: 1,
      zIndex: HYBRID_OVERLAY_Z,
    });
  }

  return { under, over, hybrid, contours };
};

export type BuiltLayer = { layer: TileLayer; opacity: number; zIndex: number };
export type BuiltStack = { under: BuiltLayer[]; over: BuiltLayer[] };

/** Opacity and z-index come back alongside each layer rather than applied: a
 *  run found stale afterwards must not have faded or reordered a layer the
 *  current stack still uses. `null` if the featured layer failed. */
export const buildStack = async (
  stack: ResolvedStack,
  projection: string,
  ns: LayerNamespace = 'bg',
  host?: OlMap,
): Promise<BuiltStack | null> => {
  const build = (entries: StackEntry[]) =>
    Promise.all(
      entries.map(async (e) => ({
        layer: await buildOrReuseBackgroundLayer(
          e.config,
          projection,
          ns,
          host,
        ),
        opacity: e.opacity,
        zIndex: e.zIndex,
      })),
    );

  const [under, over] = await Promise.all([
    build(stack.under),
    build(stack.over),
  ]);
  if (!over[0]?.layer) return null;

  const present = (e: {
    layer: TileLayer | null;
    opacity: number;
    zIndex: number;
  }): e is BuiltLayer => e.layer != null;
  return { under: under.filter(present), over: over.filter(present) };
};
