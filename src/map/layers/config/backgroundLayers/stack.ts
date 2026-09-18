import TileLayer from 'ol/layer/Tile';
import { BackgroundLayerName } from '../../backgroundLayers';
import { buildNationalLidarConfig } from './elevation';
import {
  buildFlyfotoProjectConfig,
  FLYFOTO_MOSAIC_CONFIG,
} from './flyfotoBackground';
import type { FlyfotoProject } from '../../../../localities/flyfotoProjects';
import { AMTSKART_CONFIG } from './kartVariants';
import { KvCacheBackgroundLayers } from './kvCache';
import {
  DEFAULT_LIDAR_PROJECT_STYLE,
  LidarModel,
  LidarProject,
  LIDAR_PROJECT_WMS_URL,
} from './lidarProjects';
import { buildTopoOverlayConfig } from './topoOverlay';
import {
  BackgroundLayer,
  EmptyBackgroundLayer,
  WMSBackgroundLayer,
} from './types';
import { buildOrReuseBackgroundLayer, LayerNamespace } from './utils';

// What a background mode puts on the map: a mode is never one layer. Split so
// `resolveStack` is pure and only `buildStack` awaits, so a caller can drop a
// stale run before it mutates anything.

// Layers with holes want topo showing through: the LiDAR WMS layers and a
// single ortofoto acquisition answer transparent outside their coverage, and
// amtskart has no sheets north of Nordland. Not the mosaic: opaque JPEG.
const NEEDS_TOPO_BASE = new Set<BackgroundLayerName>([
  'lidarProject',
  'lidarHillshade',
  'flyfotoProject',
  'amtskart',
]);

// Which layers the LiDAR modifiers mean anything for — not NEEDS_TOPO_BASE,
// which also holds flyfotoProject.
export const LIDAR_LAYERS = new Set<BackgroundLayerName>([
  'lidarProject',
  'lidarHillshade',
]);

// How far the layer under a per-project dataset is dimmed.
const FALLBACK_OPACITY = 0.6;

const emptyBackgroundLayer: EmptyBackgroundLayer = {
  type: 'Empty',
  layerName: 'empty',
};

// Only the fixed layers; the four whose style or acquisition is a runtime
// choice are built from atoms by `pickLayerConfig` below.
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
    LAYERS: `${project.id}:${style}`,
    VERSION: '1.3.0',
  },
  // The acquisition's own footprint: the service advertises every project.
  coverageExtent: { extent: project.bboxLonLat, crs: 'EPSG:4326' },
});

export type StackOptions = {
  lidarProject: LidarProject | null;
  /** Already clamped for the model — see `effectiveLidarStyle`. */
  lidarStyle: string;
  lidarModel: LidarModel;
  flyfotoProject: FlyfotoProject | null;
  hybridOverlay: boolean;
  /** Contour lines on the hybrid overlay. Inert without `hybridOverlay`. */
  hybridContours: boolean;
};

export type StackEntry = { config: BackgroundLayer; opacity: number };

export type ResolvedStack = {
  /** Bottom-first, everything the featured dataset sits on top of. */
  under: StackEntry[];
  /** Bottom-first, and `over[0]` is always the featured dataset itself. */
  over: StackEntry[];
  /** What the URL follows, rather than the atoms, so a shared link reproduces
      what is on screen. */
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

/** The whole stack for one background mode, as configs. `null` means nothing
 *  to draw: an unknown name, or an archive layer with no acquisition yet. */
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
    if (topo) under.push({ config: topo, opacity: 1 });
  }

  // The seamless product of the same kind goes under a per-project dataset,
  // faded. The LiDAR fallback is fixed to skyggerelieff, the mosaic's only one.
  const fallback =
    layerName === 'lidarProject'
      ? buildNationalLidarConfig(DEFAULT_LIDAR_PROJECT_STYLE, opts.lidarModel)
      : layerName === 'flyfotoProject'
        ? FLYFOTO_MOSAIC_CONFIG
        : null;
  if (fallback) under.push({ config: fallback, opacity: FALLBACK_OPACITY });

  // Only over terrain: on the topo map it redraws the base's roads and names.
  const hybrid = opts.hybridOverlay && LIDAR_LAYERS.has(layerName);
  // Contours ride the overlay's own GetMap, so without it there is nothing.
  const contours = hybrid && opts.hybridContours;
  const over: StackEntry[] = [{ config: featured, opacity: 1 }];
  if (hybrid) {
    over.push({ config: buildTopoOverlayConfig(contours), opacity: 1 });
  }

  return { under, over, hybrid, contours };
};

export type BuiltLayer = { layer: TileLayer; opacity: number };
export type BuiltStack = { under: BuiltLayer[]; over: BuiltLayer[] };

/** The same stack as OL layers. Opacity comes back alongside each layer rather
 *  than applied, since a run found stale afterwards must not have faded a layer
 *  the current stack still uses. `null` if the featured layer failed. */
export const buildStack = async (
  stack: ResolvedStack,
  projection: string,
  ns: LayerNamespace = 'bg',
): Promise<BuiltStack | null> => {
  const build = (entries: StackEntry[]) =>
    Promise.all(
      entries.map(async (e) => ({
        layer: await buildOrReuseBackgroundLayer(e.config, projection, ns),
        opacity: e.opacity,
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
  }): e is BuiltLayer => e.layer != null;
  return { under: under.filter(present), over: over.filter(present) };
};
