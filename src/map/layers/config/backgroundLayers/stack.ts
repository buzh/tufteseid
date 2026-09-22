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

// What a background mode puts on the map: a mode is never one layer. Split so
// `resolveStack` is pure and only `buildStack` awaits, so a caller can drop a
// stale run before it mutates anything.

// Layers with holes want topo showing through: the LiDAR WMS layers and a
// single ortofoto acquisition answer transparent outside their coverage, and
// amtskart has no sheets north of Nordland. Not the mosaic: opaque JPEG.
const NEEDS_TOPO_BASE = new Set<BackgroundLayerName>([
  'lidarProject',
  'lidarHillshade',
  'lidarCvat',
  'flyfotoProject',
  'amtskart',
]);

// Which layers the LiDAR modifiers mean anything for — not NEEDS_TOPO_BASE,
// which also holds flyfotoProject. The cached ground is in it because the
// hybrid overlay and its contours mean the same thing over relief however the
// relief was computed.
export const LIDAR_LAYERS = new Set<BackgroundLayerName>([
  'lidarProject',
  'lidarHillshade',
  'lidarCvat',
]);

// How far the layer under a per-project dataset is dimmed.
const FALLBACK_OPACITY = 0.6;

// NDH project rasters are 0.25 m at their finest and 0.5 m for most flights,
// so z17 (0.166 m/px) already asks the renderer for more than it holds. The
// three levels above it are pure interpolation, and this is the most expensive
// service in the stack to ask: 3-12 s a cold tile, parameterized per project so
// MapProxy can never cache it, and on the shared wms.geonorge.no budget. One
// level of magnification past native is kept deliberately — it is the
// difference between a soft image and no image when reading a small feature.
const LIDAR_PROJECT_MAX_ZOOM = 17;

const emptyBackgroundLayer: EmptyBackgroundLayer = {
  type: 'Empty',
  layerName: 'empty',
};

// Only the fixed layers; the five whose style or acquisition is a runtime
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
    // `wmsLidarStyle`, because `cvat` is a render of this flight that no
    // service publishes: a stack that arrived here holding it would ask for a
    // layer name the WMS answers with a JSON error body and a blank tile.
    LAYERS: `${project.id}:${wmsLidarStyle(style)}`,
    VERSION: '1.3.0',
  },
  maxZoom: LIDAR_PROJECT_MAX_ZOOM,
  // The acquisition's own footprint: the service advertises every project.
  coverageExtent: { extent: project.bboxLonLat, crs: 'EPSG:4326' },
});

export type StackOptions = {
  lidarProject: LidarProject | null;
  /** Which acquisition the cached ground is showing. Null before the manifest
      and the catalogue have both landed, and so a normal state at startup. */
  cvatAcquisition: CvatAcquisition | null;
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

  // The seamless product of the same kind goes under a dataset that has holes,
  // faded. The LiDAR fallback is fixed to skyggerelieff, the mosaic's only one —
  // and to DTM under the cached ground, which was computed from terrain and has
  // no model toggle on the bar: a held DOM would put a surface mosaic in the
  // holes with no way to say otherwise.
  const fallback =
    layerName === 'lidarProject'
      ? buildNationalLidarConfig(DEFAULT_LIDAR_PROJECT_STYLE, opts.lidarModel)
      : layerName === 'lidarCvat'
        ? buildNationalLidarConfig(DEFAULT_LIDAR_PROJECT_STYLE, 'dtm')
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
 *  the current stack still uses. `null` if the featured layer failed. `host` is
 *  the map the layers are destined for, and only the split view's right pane
 *  passes one. */
export const buildStack = async (
  stack: ResolvedStack,
  projection: string,
  ns: LayerNamespace = 'bg',
  host?: OlMap,
): Promise<BuiltStack | null> => {
  const build = (entries: StackEntry[]) =>
    Promise.all(
      entries.map(async (e) => ({
        layer: await buildOrReuseBackgroundLayer(e.config, projection, ns, host),
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
