import TileLayer from 'ol/layer/Tile';
import { BackgroundLayerName } from '../../backgroundLayers';
import { buildNationalLidarConfig } from './elevation';
import {
  buildFlyfotoProjectConfig,
  FLYFOTO_MOSAIC_CONFIG,
} from './flyfotoBackground';
import type { FlyfotoProject } from '../../../../localities/flyfotoProjects';
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

/*
 * What a background *mode* actually puts on the map.
 *
 * A mode is never one layer — a per-project dataset wants a topo base and a
 * faded national mosaic under it, hybrid wants roads and names over it. That
 * arrangement used to be inline in `backgroundLayerAtomEffect`, which was
 * fine while there was exactly one stack on the map. The compare curtain
 * (src/map/compare/) needs a *second* one resolved by the same rules, so the
 * rules live here and the effect became a caller.
 *
 * Split in two on purpose: `resolveStack` is pure and synchronous — configs
 * only, no map, no network — and `buildStack` is the part that awaits. That
 * lets a caller decide what a stale run is allowed to do before anything is
 * mutated.
 */

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
export const LIDAR_LAYERS = new Set<BackgroundLayerName>([
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
// 'flyfotoProject' are all built from atoms by `pickLayerConfig` below —
// their style or their acquisition is a runtime choice, so none of them has
// a static entry here.
export const allConfiguredBackgroundLayers = [
  emptyBackgroundLayer,
  ...KvCacheBackgroundLayers,
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
  // The acquisition's own footprint, not the service's. A single
  // project covers a county at most, while wms.hoyde-dtm-prosjekt
  // advertises the union of all 1936 of them (Jan Mayen to Svalbard) —
  // so the per-project bbox culls far more of the pointless renders.
  coverageExtent: { extent: project.bboxLonLat, crs: 'EPSG:4326' },
});

/** Everything a stack needs that isn't the layer name itself. */
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
  /** Whether the hybrid overlay ended up in the stack. The URL follows the
      stack rather than the atom — a shared link should reproduce what is on
      screen, and `?hybrid=true` over a 1937 photograph would not. */
  hybrid: boolean;
  /** Whether that overlay was asked for contours. Same rule, one level down:
      contours ride on the hybrid overlay, so without it there are none. */
  contours: boolean;
};

// The four dynamic layers are built from the options; everything else is a
// static entry looked up by name.
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

/**
 * The whole stack for one background mode, as configs.
 *
 * `null` means there is nothing to draw: either the name is unknown, or it
 * names an archive layer whose acquisition has not been picked yet. Callers
 * distinguish the two — the second is a normal state, not a fault.
 */
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

  // A per-project dataset typically covers a fraction of the screen.
  // Dropping to topo outside its footprint reads as "the terrain stopped",
  // and while cycling projects it's the loudest thing on screen. The
  // seamless national product underneath instead keeps coverage everywhere,
  // and faded it stays clearly subordinate to the project — the coverage
  // edge is the contrast step, not a switch to a different kind of map. For
  // LiDAR that's the national mosaic, fixed to its own style (it publishes
  // skyggerelieff and nothing else); for one ortofoto acquisition it's the
  // best-available ortofoto mosaic, i.e. the same ground photographed
  // recently.
  const fallback =
    layerName === 'lidarProject'
      ? buildNationalLidarConfig(DEFAULT_LIDAR_PROJECT_STYLE, opts.lidarModel)
      : layerName === 'flyfotoProject'
        ? FLYFOTO_MOSAIC_CONFIG
        : null;
  if (fallback) under.push({ config: fallback, opacity: FALLBACK_OPACITY });

  // Only meaningful over terrain — on the plain topo map it would just
  // redraw roads and names the base already has.
  const hybrid = opts.hybridOverlay && LIDAR_LAYERS.has(layerName);
  // Contours are a modifier on the overlay, not on the ground: they arrive as
  // two more groups in the same GetMap, so there is nothing to add when the
  // overlay itself is not in the stack.
  const contours = hybrid && opts.hybridContours;
  const over: StackEntry[] = [{ config: featured, opacity: 1 }];
  if (hybrid) {
    over.push({ config: buildTopoOverlayConfig(contours), opacity: 1 });
  }

  return { under, over, hybrid, contours };
};

export type BuiltLayer = { layer: TileLayer; opacity: number };
export type BuiltStack = { under: BuiltLayer[]; over: BuiltLayer[] };

/**
 * The same stack as OL layers, built in parallel — cheaper than
 * sequentially, and it keeps the install atomic: the whole stack is ready
 * before anything touches the map.
 *
 * Opacity comes back alongside each layer rather than already applied. The
 * build awaits (a WMTS base needs its capabilities the first time), and the
 * caller may decide in the meantime that this run is stale — at which point
 * it must not have faded a layer the current stack is still using.
 *
 * `null` when the featured layer failed to build. The rest of the stack is
 * context, and a stack missing a piece of context is still the right
 * picture, so those are simply dropped.
 */
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
