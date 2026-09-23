import type { Dem } from './dem';
import {
  computeHillshade,
  computeHorizonFields,
  computeLrm,
  computeMultiHillshade,
  computeSlope,
  computeVat,
  horizonMaxRadiusMetres,
  percentileRange,
  toImageData,
  type HorizonFields,
  type Ramp,
  type Visualization,
} from './shade';

// Degrees, degrees, dimensionless vertical exaggeration.
export const DEFAULT_AZIMUTH = 315;
export const DEFAULT_ALTITUDE = 35;
export const DEFAULT_Z_FACTOR = 2;

// Metres.
export const DEFAULT_LRM_RADIUS = 15;
export const DEFAULT_SVF_RADIUS = 20;

// The views that share one horizon scan, so the first asked for pays the whole
// cost. VAT is not among them: its radii are pinned by its presets.
const HORIZON_VIS: readonly Visualization[] = ['svf', 'openPos', 'openNeg'];

export const usesHorizon = (vis: Visualization): boolean =>
  HORIZON_VIS.includes(vis);

export const defaultRadius = (vis: Visualization): number =>
  usesHorizon(vis) ? DEFAULT_SVF_RADIUS : DEFAULT_LRM_RADIUS;

// Metres, or null for the views with no radius.
export const radiusRange = (
  vis: Visualization,
  dem: Dem,
): { min: number; max: number; step: number } | null => {
  if (usesHorizon(vis)) {
    return {
      min: 2,
      max: Math.round(horizonMaxRadiusMetres(dem.metresPerPx)),
      step: 1,
    };
  }
  if (vis === 'lrm') return { min: 5, max: 60, step: 5 };
  return null;
};

// The radius actually used; everything that renders or describes a render goes
// through this.
export const clampRadius = (
  vis: Visualization,
  dem: Dem,
  radiusMetres: number,
): number => {
  const range = radiusRange(vis, dem);
  if (!range) return radiusMetres;
  return Math.min(range.max, Math.max(range.min, radiusMetres));
};

export type TerrainLight = {
  azimuth: number;
  altitude: number;
  zFactor: number;
};

// The expensive, sun-independent pass; null for the views that have none. The
// horizon scan is ~800 ms on a 600² grid, so a radius control must not fire per
// drag frame. Pass `horizon` to reuse a walk already made at this radius.
export const terrainStaticField = (
  dem: Dem,
  vis: Visualization,
  radiusMetres: number = defaultRadius(vis),
  horizon?: HorizonFields | null,
): Float32Array | null => {
  if (vis === 'vat') return computeVat(dem);
  const radius = clampRadius(vis, dem, radiusMetres);
  if (vis === 'lrm') return computeLrm(dem, radius);
  if (!usesHorizon(vis)) return null;

  const fields = horizon ?? computeHorizonFields(dem, radius);
  switch (vis) {
    case 'svf':
      return fields.svf;
    case 'openPos':
      return fields.openPos;
    default:
      return fields.openNeg;
  }
};

// The pass that reacts to the light. VAT falls through to `staticField`: its
// hillshade was lit by the frozen VAT sun and must not be re-lit here.
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

// Cut a field computed over the whole grid back to the rectangle asked for.
const cropToWindow = (field: Float32Array, dem: Dem): Float32Array => {
  const { x, y, width, height } = dem.window;
  if (width === dem.width && height === dem.height) return field;
  const out = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    out.set(
      field.subarray((y + row) * dem.width + x, (y + row) * dem.width + x + width),
      row * width,
    );
  }
  return out;
};

export const paintTerrainField = (
  rawField: Float32Array,
  dem: Dem,
  vis: Visualization,
  canvas: HTMLCanvasElement = document.createElement('canvas'),
): HTMLCanvasElement | null => {
  const field = cropToWindow(rawField, dem);
  const { width, height } = dem.window;
  // Assigning either dimension resets the canvas, so only do it when the grid
  // changed; otherwise every slider frame reallocates a multi-megapixel buffer.
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // VAT needs no case: it composites to 0..1 on the absolute stretches in
  // VAT_PRESETS, and a percentile stretch would undo that calibration.
  let ramp: Ramp = 'grey';
  let range: [number, number] = [0, 1];
  if (vis === 'slope') {
    ramp = 'greyInverted';
    range = [0, percentileRange(field, 0.02, 0.98)[1]];
  } else if (vis === 'svf' || vis === 'openPos') {
    range = percentileRange(field, 0.02, 0.98);
  } else if (vis === 'openNeg') {
    // High in a depression, so painted straight it would put hollows in white
    // where sky-view and slope put them in black.
    ramp = 'greyInverted';
    range = percentileRange(field, 0.02, 0.98);
  } else if (vis === 'lrm') {
    ramp = 'diverging';
    // Symmetric about zero, or the neutral tone drifts off "no local relief".
    const [lo, hi] = percentileRange(field, 0.02, 0.98);
    const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    range = [-m, m];
  }
  ctx.putImageData(toImageData(field, width, height, ramp, range), 0, 0);
  return canvas;
};

// Off the window's pixel offsets, not `dem.bbox25833`: the margin is cropped in
// whole pixels, so the two differ by up to half a pixel.
export const demImageExtent = (dem: Dem): [number, number, number, number] => {
  const [minX, , , maxY] = dem.grid25833;
  const { x, y, width, height } = dem.window;
  const west = minX + x * dem.metresPerPx;
  const north = maxY - y * dem.metresPerPx;
  return [
    west,
    north - height * dem.metresPerPx,
    west + width * dem.metresPerPx,
    north,
  ];
};
