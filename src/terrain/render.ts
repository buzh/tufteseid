// Terrenganalyse without a control surface: DEM → field → pixels, so a render
// can be produced with nobody watching. Three steps rather than one `render()`
// because the split between `terrainStaticField` and `terrainField` is
// load-bearing: sky-view factor is ~800 ms on a 600² grid and `useTerrainAnalysis`
// memoizes the two separately, so dragging the azimuth slider cannot queue a
// multi-second recompute per frame. `radius` is the only knob on the expensive
// side, which is why its slider commits on release.

import type { LocalityBbox } from '../api/localities';
import { fetchDem, type Dem, type DemModel } from './dem';
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

// Only the sun-dependent views react to these three.
export const DEFAULT_AZIMUTH = 315;
export const DEFAULT_ALTITUDE = 35;
export const DEFAULT_Z_FACTOR = 2;

// Metres. The LRM smoothing radius has to be comfortably larger than the
// features being hunted; 15 m suits mounds and ditches.
export const DEFAULT_LRM_RADIUS = 15;
export const DEFAULT_SVF_RADIUS = 20;

// The views read off the horizon scan (`computeHorizonFields`) and offer the
// reader a radius for it. They share one radius and one result, so the first
// one asked for pays the whole cost and the rest are a selection. VAT is not
// among them although it walks the same rays twice: its two radii are pinned by
// the presets, the way its sun is, so it has neither a slider to answer nor a
// scan to share.
const HORIZON_VIS: readonly Visualization[] = ['svf', 'openPos', 'openNeg'];

export const usesHorizon = (vis: Visualization): boolean =>
  HORIZON_VIS.includes(vis);

/** Where the radius starts for the views that have one. */
export const defaultRadius = (vis: Visualization): number =>
  usesHorizon(vis) ? DEFAULT_SVF_RADIUS : DEFAULT_LRM_RADIUS;

/**
 * What a radius control may offer for this visualization over this grid, in
 * metres, or `null` for the views that have no radius. The horizon ceiling is
 * `horizonMaxRadiusMetres` — 24 m on any grid at 1 m or finer, 24 × the cell
 * size on a coarser one. LRM's box blur is O(n) per pass at any radius, so 60 m
 * is a judgement about scale: past it the smoothed copy is a plane.
 */
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

/**
 * The radius that will actually be used. Everything that renders *or describes*
 * a render goes through this, or a caption reads "SVF-radius 40 m" over a 24 m
 * render.
 */
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

export const DEFAULT_LIGHT: TerrainLight = {
  azimuth: DEFAULT_AZIMUTH,
  altitude: DEFAULT_ALTITUDE,
  zFactor: DEFAULT_Z_FACTOR,
};

/**
 * The expensive, sun-independent pass; `null` for the visualizations that have
 * none. `radiusMetres` is the one knob on this side, so a control for it must
 * not fire per drag frame: the horizon scan is ~800 ms on a 600² grid. Pass
 * `horizon` to reuse a walk already made at this radius — that is what makes
 * switching between sky-view and the two opennesses instant — or omit it and
 * this recomputes. VAT is on this side despite containing a hillshade, because
 * its sun is frozen (VAT_AZIMUTH); it walks its own two rays and takes no
 * radius, so nothing it computes can be shared with the three above.
 */
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

/**
 * The pass that reacts to the light. `staticField` is handed back unchanged for
 * the sun-independent views — VAT among them, since its own hillshade was lit
 * by the frozen sun on the static side and must not be re-lit here.
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
 * Cut a field computed over the whole grid back to the rectangle that was asked
 * for. Every field is computed on the margin too — that is the point of having
 * one — and none of it is shown.
 */
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

/**
 * Field → pixels, onto `canvas` when one is passed (the panel reuses the
 * element the map's image layer draws from) or a fresh one otherwise. The
 * shaded views are already normalised to 0..1; the physical ones need a robust
 * stretch, or a single spike swallows the whole ramp.
 */
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

  // VAT needs no case: its layers are mixed on the absolute stretches in
  // VAT_PRESETS and it composites to 0..1, so re-stretching the composite to
  // this hillside's percentiles would undo the calibration.
  let ramp: Ramp = 'grey';
  let range: [number, number] = [0, 1];
  if (vis === 'slope') {
    ramp = 'greyInverted';
    range = [0, percentileRange(field, 0.02, 0.98)[1]];
  } else if (vis === 'svf' || vis === 'openPos') {
    range = percentileRange(field, 0.02, 0.98);
  } else if (vis === 'openNeg') {
    // Inverted so a hollow is dark here as in sky-view and slope: negative
    // openness is high in a depression, so the raw field paints ditches white.
    // RVT inverts it in the same place (`normalize_image`).
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

/**
 * Where a painted canvas actually lands. The grid is sized from the bbox width,
 * so the last row falls a fraction of a pixel short of the southern edge, and
 * the margin is cropped off in whole pixels; deriving the extent from the
 * window's pixel offsets rather than reusing `dem.bbox25833` keeps the image
 * registered against both.
 */
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

export type TerrainRenderOptions = {
  vis: Visualization;
  model?: DemModel;
  light?: TerrainLight;
  /** Metres; only `lrm` and the horizon views read it. */
  radius?: number;
  signal?: AbortSignal;
};

export type TerrainRender = {
  canvas: HTMLCanvasElement;
  dem: Dem;
  /**
   * The radius the pixels were actually computed with, or undefined for the
   * views that have none: `clampRadius` needs the DEM, and the DEM is fetched
   * in here. Whatever describes this render — a figure caption, a stored
   * `meta` — must print this number and not the requested one.
   */
  radius?: number;
};

/**
 * The whole path, for callers with no panel: fetch the float DEM for a
 * rectangle and paint one visualization of it. `null` when the rectangle has no
 * laser data or the canvas could not be obtained; fetch failures throw, because
 * reporting "no coverage" for a network fault would be a lie.
 */
export const renderTerrain = async (
  bbox: LocalityBbox,
  {
    vis,
    model = 'dtm',
    light = DEFAULT_LIGHT,
    radius,
    signal,
  }: TerrainRenderOptions,
): Promise<TerrainRender | null> => {
  const dem = await fetchDem(bbox, { model, signal });
  if (!dem) return null;
  // Clamped against *this* grid, so a stored spec re-rendered over a rectangle
  // that has since been resized is clamped again on the way in.
  const effective = radius != null ? clampRadius(vis, dem, radius) : undefined;
  const staticField = terrainStaticField(dem, vis, effective);
  const field = terrainField(dem, vis, light, staticField);
  if (!field) return null;
  const canvas = paintTerrainField(field, dem, vis);
  return canvas ? { canvas, dem, radius: effective } : null;
};
