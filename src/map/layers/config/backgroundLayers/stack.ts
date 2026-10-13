import TileLayer from 'ol/layer/Tile';
import type OlMap from 'ol/Map';
import { BackgroundLayerName } from '../../backgroundLayers';
import { getWMSTileGrid } from '../../wmsTileGrid';
import { buildCvatGroundConfig, type CvatAcquisition } from './cvatGround';
import { buildNationalLidarConfig, NATIONAL_CACHE_MAX_ZOOM } from './elevation';
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

const NEEDS_TOPO_BASE = new Set<BackgroundLayerName>([
  'lidarProject',
  'lidarHillshade',
  'lidarCvat',
  'flyfotoProject',
  'amtskart',
]);

export const LIDAR_LAYERS = new Set<BackgroundLayerName>([
  'lidarProject',
  'lidarHillshade',
  'lidarCvat',
]);

const FALLBACK_OPACITY = 0.6;

const GROUND_Z = 0;
const HYBRID_OVERLAY_Z = 0.75;

const LIDAR_PROJECT_MAX_ZOOM = 17;

const lidarNativeMaxZoom = (
  layerName: BackgroundLayerName,
  cvat: CvatAcquisition | null,
): number | null => {
  switch (layerName) {
    case 'lidarCvat':
      return cvat?.maxZoom ?? null;
    case 'lidarHillshade':
      return NATIONAL_CACHE_MAX_ZOOM;
    case 'lidarProject':
      return LIDAR_PROJECT_MAX_ZOOM;
    default:
      return null;
  }
};

export const lidarNativeResolution = (
  layerName: BackgroundLayerName,
  cvat: CvatAcquisition | null,
): number | null => {
  const z = lidarNativeMaxZoom(layerName, cvat);
  if (z == null) return null;
  return getWMSTileGrid('EPSG:25833')?.getResolution(z) ?? null;
};

const emptyBackgroundLayer: EmptyBackgroundLayer = {
  type: 'Empty',
  layerName: 'empty',
};

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
    LAYERS: `${project.id}:${wmsLidarStyle(style)}`,
    VERSION: '1.3.0',
  },
  maxZoom: LIDAR_PROJECT_MAX_ZOOM,
  interpolate: false,
  coverageExtent: { extent: project.bboxLonLat, crs: 'EPSG:4326' },
});

export type StackOptions = {
  lidarProject: LidarProject | null;
  cvatAcquisition: CvatAcquisition | null;
  lidarStyle: string;
  lidarModel: LidarModel;
  flyfotoProject: FlyfotoProject | null;
  hybridOverlay: boolean;
  hybridContours: boolean;
};

export type StackEntry = {
  config: BackgroundLayer;
  opacity: number;
  zIndex: number;
};

export type ResolvedStack = {
  under: StackEntry[];
  over: StackEntry[];
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

  const hybrid = opts.hybridOverlay && LIDAR_LAYERS.has(layerName);
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
