// Terrenganalyse without a control surface: DEM → field → pixels.
//
// Extracted from the terrain control surface so "Hent grunnpakke" can produce
// the same render with nobody watching. `useTerrainAnalysis` keeps every knob;
// what moved here is only the arithmetic between a knob position and a canvas,
// which is why the three functions below are its three steps and not one
// `render()`.
//
// **The split between `terrainStaticField` and `terrainField` is
// load-bearing** (docs/ui-architecture.md §10). Sky-view factor is ~800 ms on
// a 600² grid; the panel memoizes the two separately so dragging the azimuth
// slider cannot queue a multi-second recompute per frame. Joining them here
// would put that back the first time someone reached for the "simpler" API.

import type { LocalityBbox } from '../api/localities';
import { fetchDem, type Dem, type DemModel } from './dem';
import {
  computeHillshade,
  computeLrm,
  computeMultiHillshade,
  computeSlope,
  computeSvf,
  percentileRange,
  toImageData,
  type Ramp,
  type Visualization,
} from './shade';

// Only the sun-dependent views react to the first three, which is why the
// panel splits its memos on exactly that line.
export const DEFAULT_AZIMUTH = 315;
export const DEFAULT_ALTITUDE = 35;
export const DEFAULT_Z_FACTOR = 2;

// Metres. The LRM smoothing radius has to be comfortably larger than the
// features being hunted or it removes them along with the landform trend;
// 15 m suits mounds and ditches.
export const DEFAULT_LRM_RADIUS = 15;
export const DEFAULT_SVF_RADIUS = 20;

export type TerrainLight = {
  azimuth: number;
  altitude: number;
  zFactor: number;
};

export const DEFAULT_LIGHT: TerrainLight = {
  azimuth: DEFAULT_AZIMUTH,
  altitude: DEFAULT_ALTITUDE,
  zFactor: DEFAULT_Z_FACTOR,
};

/**
 * The expensive, sun-independent pass. `null` for the visualizations that
 * have none — they are computed by `terrainField` instead, cheaply.
 */
export const terrainStaticField = (
  dem: Dem,
  vis: Visualization,
): Float32Array | null => {
  if (vis === 'svf') return computeSvf(dem, DEFAULT_SVF_RADIUS);
  if (vis === 'lrm') return computeLrm(dem, DEFAULT_LRM_RADIUS);
  return null;
};

/**
 * The pass that reacts to the light. `staticField` is whatever the call above
 * returned for this `vis`, and is simply handed back for the two views that
 * are entirely sun-independent.
 */
export const terrainField = (
  dem: Dem,
  vis: Visualization,
  light: TerrainLight,
  staticField: Float32Array | null,
): Float32Array | null => {
  switch (vis) {
    case 'hillshade':
      return computeHillshade(
        dem,
        light.azimuth,
        light.altitude,
        light.zFactor,
      );
    case 'multiHillshade':
      return computeMultiHillshade(dem, light.altitude, light.zFactor);
    case 'slope':
      return computeSlope(dem, light.zFactor);
    default:
      return staticField;
  }
};

/**
 * Field → pixels, onto `canvas` when one is passed (the panel reuses the
 * element the map's image layer draws from) or a fresh one otherwise.
 *
 * Ranges differ per visualization: the shaded ones are already normalised to
 * 0..1, the physical ones need a robust stretch because a single spike or the
 * flat 0.0 plane over water would otherwise swallow the whole ramp.
 */
export const paintTerrainField = (
  field: Float32Array,
  dem: Dem,
  vis: Visualization,
  canvas: HTMLCanvasElement = document.createElement('canvas'),
): HTMLCanvasElement | null => {
  // Assigning either dimension resets the canvas, so only do it when the grid
  // actually changed — otherwise every slider frame reallocates a
  // multi-megapixel buffer that putImageData is about to overwrite anyway.
  if (canvas.width !== dem.width || canvas.height !== dem.height) {
    canvas.width = dem.width;
    canvas.height = dem.height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  let ramp: Ramp = 'grey';
  let range: [number, number] = [0, 1];
  if (vis === 'slope') {
    ramp = 'greyInverted';
    range = [0, percentileRange(field, 0.02, 0.98)[1]];
  } else if (vis === 'svf') {
    range = percentileRange(field, 0.02, 0.98);
  } else if (vis === 'lrm') {
    ramp = 'diverging';
    // Symmetric about zero, or the neutral tone drifts off the "no local
    // relief" value and two renders stop being comparable.
    const [lo, hi] = percentileRange(field, 0.02, 0.98);
    const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    range = [-m, m];
  }
  ctx.putImageData(toImageData(field, dem.width, dem.height, ramp, range), 0, 0);
  return canvas;
};

/**
 * The grid is sized from the bbox width, so the last row lands a fraction of
 * a pixel short of the southern edge. Deriving the extent from the pixel count
 * rather than reusing `dem.bbox25833` keeps the image registered to the ground
 * it actually holds.
 */
export const demImageExtent = (dem: Dem): [number, number, number, number] => {
  const [minX, , , maxY] = dem.bbox25833;
  return [
    minX,
    maxY - dem.height * dem.metresPerPx,
    minX + dem.width * dem.metresPerPx,
    maxY,
  ];
};

export type TerrainRenderOptions = {
  vis: Visualization;
  model?: DemModel;
  light?: TerrainLight;
  signal?: AbortSignal;
};

export type TerrainRender = {
  canvas: HTMLCanvasElement;
  dem: Dem;
};

/**
 * The whole path, for callers with no panel: fetch the float DEM for a
 * rectangle and paint one visualization of it.
 *
 * `null` when the rectangle has no laser data (`fetchDem` says so before a
 * megabyte moves) or the canvas could not be obtained. Fetch failures throw,
 * because a caller reporting "no coverage" for a network fault would be a lie.
 */
export const renderTerrain = async (
  bbox: LocalityBbox,
  { vis, model = 'dtm', light = DEFAULT_LIGHT, signal }: TerrainRenderOptions,
): Promise<TerrainRender | null> => {
  const dem = await fetchDem(bbox, { model, signal });
  if (!dem) return null;
  const field = terrainField(dem, vis, light, terrainStaticField(dem, vis));
  if (!field) return null;
  const canvas = paintTerrainField(field, dem, vis);
  return canvas ? { canvas, dem } : null;
};
