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

export const DEFAULT_AZIMUTH = 315;
export const DEFAULT_ALTITUDE = 35;
export const DEFAULT_Z_FACTOR = 2;

export const DEFAULT_LRM_RADIUS = 15;
export const DEFAULT_SVF_RADIUS = 20;

const HORIZON_VIS: readonly Visualization[] = ['svf', 'openPos', 'openNeg'];

export const usesHorizon = (vis: Visualization): boolean =>
  HORIZON_VIS.includes(vis);

export const defaultRadius = (vis: Visualization): number =>
  usesHorizon(vis) ? DEFAULT_SVF_RADIUS : DEFAULT_LRM_RADIUS;

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

const cropToWindow = (field: Float32Array, dem: Dem): Float32Array => {
  const { x, y, width, height } = dem.window;
  if (width === dem.width && height === dem.height) return field;
  const out = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    out.set(
      field.subarray(
        (y + row) * dem.width + x,
        (y + row) * dem.width + x + width,
      ),
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

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  let ramp: Ramp = 'grey';
  let range: [number, number] = [0, 1];
  if (vis === 'slope') {
    ramp = 'greyInverted';
    range = [0, percentileRange(field, 0.02, 0.98)[1]];
  } else if (vis === 'svf' || vis === 'openPos') {
    range = percentileRange(field, 0.02, 0.98);
  } else if (vis === 'openNeg') {

    ramp = 'greyInverted';
    range = percentileRange(field, 0.02, 0.98);
  } else if (vis === 'lrm') {
    ramp = 'diverging';

    const [lo, hi] = percentileRange(field, 0.02, 0.98);
    const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    range = [-m, m];
  }
  ctx.putImageData(toImageData(field, width, height, ramp, range), 0, 0);
  return canvas;
};

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
