// Relief visualizations over a float DEM. Each compute* returns a Float32Array
// in the DEM's own grid, NaN where the DEM has no coverage, and is separate
// from rendering so the expensive pass (the horizon scan) can be cached while
// a cheap one (hillshade azimuth) is scrubbed.

import type { Dem } from './dem';

// All any compute* here needs of a `Dem`: a float raster and the ground
// distance between its cells. A decimated copy is one of these too, so the same
// code walks the DEM's own grid and a coarsened one.
type Grid = {
  width: number;
  height: number;
  data: Float32Array;
  metresPerPx: number;
};

export type Visualization =
  | 'hillshade'
  | 'multiHillshade'
  | 'vat'
  | 'svf'
  | 'openPos'
  | 'openNeg'
  | 'lrm'
  | 'slope';

// Six azimuths over three quadrants only, weighted to peak at 315° for a net
// light from the north-west. Spanning the full circle at equal weight cancels
// the directional term by symmetry and collapses the blend to
// cos(zenith)·cos(slope) — a slope map, whose tell is a maximum of exactly
// 0.7071 at altitude 45°, i.e. nothing brighter than flat ground.
export const MULTI_AZIMUTHS = [
  { azimuth: 225, weight: 3 },
  { azimuth: 270, weight: 4 },
  { azimuth: 315, weight: 5 },
  { azimuth: 360, weight: 4 },
  { azimuth: 45, weight: 3 },
  { azimuth: 90, weight: 2 },
];

// Directions the horizon scan walks; the scan costs width × height ×
// directions × steps. 8 bands visibly, 32 doubles the cost for little gain.
export const SVF_DIRECTIONS = 16;

// Hard ceiling on the horizon search radius in *steps*: reach is bought by
// decimating, not by walking further.
export const SVF_MAX_RADIUS_PX = 24;

// Coarsest grid the scan will decimate down to, in metres per pixel, so with
// the step budget the reach is a flat 24 m on any grid at 1 m or finer; past a
// metre the surface stops resolving the features whose horizon is measured.
export const HORIZON_MIN_M_PER_PX = 1;

// 1 on anything at or coarser than HORIZON_MIN_M_PER_PX, i.e. inert there.
const maxDecimation = (metresPerPx: number): number =>
  Math.max(1, Math.floor(HORIZON_MIN_M_PER_PX / metresPerPx));

/**
 * The decimation this radius needs on this grid, and 1 when it needs none: only
 * as much as the radius asks for, so the fine end of the slider keeps every
 * pixel the DEM has. A figure caption prints it, since the horizon views are
 * then read off a coarser surface than the hillshade beside them.
 */
export const horizonDecimation = (
  metresPerPx: number,
  radiusMetres: number,
): number =>
  Math.min(
    maxDecimation(metresPerPx),
    Math.max(1, Math.ceil(radiusMetres / (metresPerPx * SVF_MAX_RADIUS_PX))),
  );

/**
 * The longest horizon search this grid can deliver, in metres. Integer
 * decimation makes it grid-dependent (21.6 m on a 0.3 m grid); `radiusRange` in
 * render.ts takes the slider's ceiling from here, so the control cannot offer a
 * position the scan would then quietly clamp.
 */
export const horizonMaxRadiusMetres = (metresPerPx: number): number =>
  SVF_MAX_RADIUS_PX * metresPerPx * maxDecimation(metresPerPx);

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

// Horn's 3×3 method, as in GDAL and Esri. Partial derivatives in metres per
// metre; NaN anywhere in the neighbourhood poisons the cell rather than
// inventing a slope at a coverage edge.
function gradients(grid: Grid): { dzdx: Float32Array; dzdy: Float32Array } {
  const { width: w, height: h, data, metresPerPx } = grid;
  const dzdx = new Float32Array(w * h).fill(NaN);
  const dzdy = new Float32Array(w * h).fill(NaN);
  const denom = 8 * metresPerPx;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      // a b c  (north)
      // d e f
      // g h i  (south)
      const a = data[i - w - 1];
      const b = data[i - w];
      const c = data[i - w + 1];
      const d = data[i - 1];
      const f = data[i + 1];
      const g = data[i + w - 1];
      const hh = data[i + w];
      const ii = data[i + w + 1];
      if (
        Number.isNaN(a) ||
        Number.isNaN(b) ||
        Number.isNaN(c) ||
        Number.isNaN(d) ||
        Number.isNaN(f) ||
        Number.isNaN(g) ||
        Number.isNaN(hh) ||
        Number.isNaN(ii)
      ) {
        continue;
      }
      dzdx[i] = (c + 2 * f + ii - (a + 2 * d + g)) / denom;
      dzdy[i] = (g + 2 * hh + ii - (a + 2 * b + c)) / denom;
    }
  }
  return { dzdx, dzdy };
}

// Slope in radians.
export function computeSlope(dem: Dem, zFactor = 1): Float32Array {
  const { dzdx, dzdy } = gradients(dem);
  return slopeFromGradients(dzdx, dzdy, zFactor);
}

function slopeFromGradients(
  dzdx: Float32Array,
  dzdy: Float32Array,
  zFactor: number,
): Float32Array {
  const out = new Float32Array(dzdx.length).fill(NaN);
  for (let i = 0; i < dzdx.length; i++) {
    if (Number.isNaN(dzdx[i])) continue;
    out[i] = Math.atan(zFactor * Math.hypot(dzdx[i], dzdy[i]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hillshade
// ---------------------------------------------------------------------------

// Illumination in 0..1. `azimuth` is compass degrees the light comes *from*
// (315 = north-west); `altitude` is degrees above the horizon.
export function computeHillshade(
  dem: Dem,
  azimuth: number,
  altitude: number,
  zFactor = 1,
): Float32Array {
  const { dzdx, dzdy } = gradients(dem);
  return shadeFromGradients(dzdx, dzdy, azimuth, altitude, zFactor);
}

// Weighted blend of six hillshades off one gradient pass.
export function computeMultiHillshade(
  dem: Dem,
  altitude: number,
  zFactor = 1,
): Float32Array {
  const { dzdx, dzdy } = gradients(dem);
  const acc = new Float32Array(dzdx.length);
  let totalWeight = 0;
  for (const { azimuth, weight } of MULTI_AZIMUTHS) {
    const shade = shadeFromGradients(dzdx, dzdy, azimuth, altitude, zFactor);
    for (let i = 0; i < acc.length; i++) acc[i] += weight * shade[i];
    totalWeight += weight;
  }
  for (let i = 0; i < acc.length; i++) acc[i] /= totalWeight;
  return acc;
}

function shadeFromGradients(
  dzdx: Float32Array,
  dzdy: Float32Array,
  azimuth: number,
  altitude: number,
  zFactor: number,
): Float32Array {
  const zenith = ((90 - altitude) * Math.PI) / 180;
  // Compass bearing → mathematical angle (counter-clockwise from east).
  const azMath = (((360 - azimuth + 90) % 360) * Math.PI) / 180;
  const cosZenith = Math.cos(zenith);
  const sinZenith = Math.sin(zenith);

  const out = new Float32Array(dzdx.length).fill(NaN);
  for (let i = 0; i < dzdx.length; i++) {
    const gx = dzdx[i];
    if (Number.isNaN(gx)) continue;
    const gy = dzdy[i];
    const slope = Math.atan(zFactor * Math.hypot(gx, gy));
    const aspect =
      gx !== 0
        ? Math.atan2(gy, -gx)
        : gy > 0
          ? Math.PI / 2
          : gy < 0
            ? -Math.PI / 2
            : 0;
    const v =
      cosZenith * Math.cos(slope) +
      sinZenith * Math.sin(slope) * Math.cos(azMath - aspect);
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Local relief model
// ---------------------------------------------------------------------------

// Hesse's local relief model: the DEM minus a smoothed copy of itself, in
// signed metres. `radiusMetres` sets what counts as landform scale and must be
// comfortably larger than the features hunted, or the smoothing eats them too.
export function computeLrm(dem: Dem, radiusMetres: number): Float32Array {
  const radiusPx = Math.max(1, Math.round(radiusMetres / dem.metresPerPx));
  const smooth = boxBlurNaNAware(dem.data, dem.width, dem.height, radiusPx);
  const out = new Float32Array(dem.data.length).fill(NaN);
  for (let i = 0; i < out.length; i++) {
    if (Number.isNaN(dem.data[i]) || Number.isNaN(smooth[i])) continue;
    out[i] = dem.data[i] - smooth[i];
  }
  return out;
}

// Three box passes approximate a Gaussian, O(n) each via a running sum.
// NaN-aware: no-data cells contribute nothing rather than dragging their
// neighbours toward zero.
function boxBlurNaNAware(
  src: Float32Array,
  w: number,
  h: number,
  radius: number,
): Float32Array {
  let cur = src;
  for (let pass = 0; pass < 3; pass++) {
    cur = blurAxis(cur, w, h, radius, true);
    cur = blurAxis(cur, w, h, radius, false);
  }
  return cur;
}

function blurAxis(
  src: Float32Array,
  w: number,
  h: number,
  radius: number,
  horizontal: boolean,
): Float32Array {
  const out = new Float32Array(src.length).fill(NaN);
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  const step = horizontal ? 1 : w;

  for (let o = 0; o < outer; o++) {
    const base = horizontal ? o * w : o;
    let sum = 0;
    let count = 0;
    // Prime the window for position 0.
    for (let i = 0; i <= radius && i < inner; i++) {
      const v = src[base + i * step];
      if (!Number.isNaN(v)) {
        sum += v;
        count++;
      }
    }
    for (let i = 0; i < inner; i++) {
      if (count > 0) out[base + i * step] = sum / count;
      // Slide: drop the cell leaving the window, add the one entering.
      const leaving = i - radius;
      const entering = i + radius + 1;
      if (leaving >= 0) {
        const v = src[base + leaving * step];
        if (!Number.isNaN(v)) {
          sum -= v;
          count--;
        }
      }
      if (entering < inner) {
        const v = src[base + entering * step];
        if (!Number.isNaN(v)) {
          sum += v;
          count++;
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The horizon scan: sky-view factor and openness, from one pass
// ---------------------------------------------------------------------------

export type HorizonFields = {
  /** Proportion of the sky hemisphere visible, 0..1. */
  svf: Float32Array;
  /** Yokoyama positive openness, degrees. Banks and mounds run high. */
  openPos: Float32Array;
  /**
   * Yokoyama negative openness, degrees. Positive openness of the inverted
   * surface, so it runs *high* in a hollow and low on a ridge — the raw field
   * paints ditches white, which is why every reader of it inverts the ramp.
   */
  openNeg: Float32Array;
};

// Sky-view factor (Zakšek, Oštir & Kokalj 2011) and Yokoyama's positive and
// negative openness: one ray walk read three ways, and returned as a set so the
// caller caches one result and rings between the views for free. Independent of
// light direction. Scans a decimated copy when the radius asks for more reach
// than the step budget allows, then interpolates back (`horizonDecimation`).
// The rays start at the first cell: the three views this serves offer the
// reader a radius, that radius is the one number on the legend, and a second
// hidden one under it would make it a fiction. VAT, which does start its rays
// out from the centre, calls `scanHorizon` on a grid it has imposed itself.
// The clamping rules differ, and that difference is the measurement: sky-view
// caps the horizon at the horizontal, since a cell sees at most a hemisphere;
// openness must not clamp, or every convexity flattens to the same value.
// Negative openness is positive openness of the inverted surface, so the second
// extremum is all the bookkeeping it needs: max(-tan) = -min(tan).
export function computeHorizonFields(
  dem: Dem,
  radiusMetres: number,
): HorizonFields {
  const factor = horizonDecimation(dem.metresPerPx, radiusMetres);
  if (factor === 1) return scanHorizon(dem, radiusMetres, 0);

  // Averaged down, scanned, and interpolated back: buys the reach the step
  // budget would otherwise cost, and is factor² cheaper besides.
  const coarse = decimate(dem, factor);
  const scanned = scanHorizon(coarse, radiusMetres, 0);
  const back = (field: Float32Array) =>
    upsample(field, coarse, dem.width, dem.height, factor, dem.data);
  return {
    svf: back(scanned.svf),
    openPos: back(scanned.openPos),
    openNeg: back(scanned.openNeg),
  };
}

// Block mean rather than a subsample: point-sampling a 0.25 m DTM every fourth
// cell hands the scan that grid's interpolation noise as if it were relief. A
// block with no readable cell stays NaN, so a coverage hole survives.
function decimate(grid: Grid, factor: number): Grid {
  const w = Math.max(1, Math.ceil(grid.width / factor));
  const h = Math.max(1, Math.ceil(grid.height / factor));
  const data = new Float32Array(w * h).fill(NaN);

  for (let y = 0; y < h; y++) {
    const y0 = y * factor;
    const y1 = Math.min(grid.height, y0 + factor);
    for (let x = 0; x < w; x++) {
      const x0 = x * factor;
      const x1 = Math.min(grid.width, x0 + factor);
      let sum = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        const row = sy * grid.width;
        for (let sx = x0; sx < x1; sx++) {
          const v = grid.data[row + sx];
          if (!Number.isNaN(v)) {
            sum += v;
            n++;
          }
        }
      }
      if (n > 0) data[y * w + x] = sum / n;
    }
  }
  return { width: w, height: h, data, metresPerPx: grid.metresPerPx * factor };
}

// Bilinear back to the DEM's own grid; nearest at factor 4 is a field of 4×4
// squares the eye reads as structure. Corners with no value drop out of the
// weighted mean rather than poisoning it, and `mask` — the DEM's own data —
// cuts the result back to cells that have an elevation, since the averaged grid
// otherwise bleeds up to `factor` pixels into unmeasured ground.
function upsample(
  field: Float32Array,
  src: Grid,
  width: number,
  height: number,
  factor: number,
  mask: Float32Array,
): Float32Array {
  const out = new Float32Array(width * height).fill(NaN);
  const { width: sw, height: sh } = src;
  const clampX = (v: number) => (v < 0 ? 0 : v >= sw ? sw - 1 : v);

  for (let y = 0; y < height; y++) {
    // Pixel centres, not corners: half a coarse cell of offset is a visible
    // shift of the whole field at factor 4.
    const fy = (y + 0.5) / factor - 0.5;
    const yf = Math.floor(fy);
    const ty = fy - yf;
    const rowA = (yf < 0 ? 0 : yf >= sh ? sh - 1 : yf) * sw;
    const yb = yf + 1;
    const rowB = (yb < 0 ? 0 : yb >= sh ? sh - 1 : yb) * sw;

    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (Number.isNaN(mask[i])) continue;

      const fx = (x + 0.5) / factor - 0.5;
      const xf = Math.floor(fx);
      const tx = fx - xf;
      const xa = clampX(xf);
      const xb = clampX(xf + 1);

      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;
      const v00 = field[rowA + xa];
      const v10 = field[rowA + xb];
      const v01 = field[rowB + xa];
      const v11 = field[rowB + xb];

      let sum = 0;
      let weight = 0;
      if (!Number.isNaN(v00)) {
        sum += v00 * w00;
        weight += w00;
      }
      if (!Number.isNaN(v10)) {
        sum += v10 * w10;
        weight += w10;
      }
      if (!Number.isNaN(v01)) {
        sum += v01 * w01;
        weight += w01;
      }
      if (!Number.isNaN(v11)) {
        sum += v11 * w11;
        weight += w11;
      }
      if (weight > 0) out[i] = sum / weight;
    }
  }
  return out;
}

// The walk itself, over the DEM's own grid or a decimated copy of it.
function scanHorizon(
  grid: Grid,
  radiusMetres: number,
  innerMetres: number,
): HorizonFields {
  const { width: w, height: h, data, metresPerPx } = grid;
  // Still clamped: `clampRadius` in render.ts caps the request first, but a
  // headless caller can reach this with any number at all.
  const radiusPx = Math.min(
    SVF_MAX_RADIUS_PX,
    Math.max(1, Math.round(radiusMetres / metresPerPx)),
  );
  // RVT's `svf_noise`, which is a search radius to *start* at rather than a
  // filter: the innermost cells of a 0.25 m laser surface are mostly the
  // interpolation between returns, and a horizon read off them is a reading of
  // the grid. Never past the outer radius, or a direction would have no steps.
  const innerPx = Math.min(
    radiusPx,
    Math.max(1, Math.round(innerMetres / metresPerPx)),
  );

  // Precompute the ray offsets once rather than per pixel.
  const rays: Array<
    Array<{ off: number; dx: number; dy: number; dist: number }>
  > = [];
  for (let d = 0; d < SVF_DIRECTIONS; d++) {
    const angle = (2 * Math.PI * d) / SVF_DIRECTIONS;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const steps: Array<{ off: number; dx: number; dy: number; dist: number }> =
      [];
    let lastOff: number | null = null;
    for (let r = innerPx; r <= radiusPx; r++) {
      const dx = Math.round(ux * r);
      const dy = Math.round(uy * r);
      const off = dy * w + dx;
      // Near the origin successive steps can round to the same cell.
      if (off === lastOff) continue;
      lastOff = off;
      steps.push({ off, dx, dy, dist: Math.hypot(dx, dy) * metresPerPx });
    }
    rays.push(steps);
  }

  const svf = new Float32Array(w * h).fill(NaN);
  const openPos = new Float32Array(w * h).fill(NaN);
  const openNeg = new Float32Array(w * h).fill(NaN);
  const toDeg = 180 / Math.PI;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const z0 = data[i];
      if (Number.isNaN(z0)) continue;

      let sky = 0;
      let zenith = 0;
      let nadir = 0;
      for (let d = 0; d < SVF_DIRECTIONS; d++) {
        // Start at 0, not ±Infinity: a direction with no readable cell at all
        // reads as a flat horizon instead of poisoning the cell.
        let maxTan = 0;
        let minTan = 0;
        let seen = false;
        for (const s of rays[d]) {
          const nx = x + s.dx;
          const ny = y + s.dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) break;
          const z = data[i + s.off];
          if (Number.isNaN(z)) continue;
          const tan = (z - z0) / s.dist;
          if (!seen) {
            maxTan = tan;
            minTan = tan;
            seen = true;
            continue;
          }
          if (tan > maxTan) maxTan = tan;
          if (tan < minTan) minTan = tan;
        }
        // 1 - sin(horizon angle), the horizon floored at level ground.
        const above = maxTan > 0 ? maxTan : 0;
        sky += 1 - above / Math.hypot(1, above);
        zenith += 90 - Math.atan(maxTan) * toDeg;
        nadir += 90 + Math.atan(minTan) * toDeg;
      }
      svf[i] = sky / SVF_DIRECTIONS;
      openPos[i] = zenith / SVF_DIRECTIONS;
      openNeg[i] = nadir / SVF_DIRECTIONS;
    }
  }
  return { svf, openPos, openNeg };
}

// ---------------------------------------------------------------------------
// VAT — the archaeology default blend
// ---------------------------------------------------------------------------

// Visualization for Archaeological Topography, as the Relief Visualization
// Toolbox defines it (`rvt/blend.py`, "VAT - Archaeological"; Kokalj & Somrak
// 2019, Remote Sensing 11(7):747). Four layers, bottom first, and printed on
// every figure because changing a number here changes what an old render means.
// The stretches are absolute, not this rectangle's percentiles as the other
// physical views use: the blend is calibrated on 0.7 sky-view meaning the same
// thing on two hillsides, which is what makes two VAT renders comparable.
//
// Absolute stretches are also why there has to be more than one set of them. On
// gentle ground the general numbers leave the whole image inside the middle
// third of the ramp — measured on a synthetic 0.5° hillside carrying a 12 m
// gravhaug and a 2 m ditch, the general stack spans 0.52–0.87 and a 0.25 m bank
// moves four grey levels. RVT answers that with a second parameter set for flat
// terrain (`settings/default_terrains_settings.json`), and combines the two.

export type VatTerrain = 'general' | 'flat';

export type VatPreset = {
  /** Degrees above the horizon. The azimuth is frozen for both. */
  sunAltitude: number;
  /** Degrees; the slope layer's stretch runs 0 to this, inverted. */
  slopeMax: number;
  opennessMin: number;
  opennessMax: number;
  /** The sky-view stretch runs this to 1. */
  svfMin: number;
  /**
   * Metres. RVT states these in pixels — 10 and 20 — against the 0.5 m laser
   * data it was written for. Metres is the faithful reading: a horizon angle
   * over a fixed distance is a fact about the ground, while over a fixed
   * pixel count it is a fact about the grid, and the stretches above are
   * calibrated against the angle.
   */
  radiusMetres: number;
  innerMetres: number;
};

export const VAT_PRESETS: Record<VatTerrain, VatPreset> = {
  general: {
    sunAltitude: 35,
    slopeMax: 50,
    opennessMin: 68,
    opennessMax: 93,
    svfMin: 0.7,
    radiusMetres: 5,
    innerMetres: 0,
  },
  flat: {
    sunAltitude: 15,
    slopeMax: 15,
    opennessMin: 85,
    opennessMax: 93,
    svfMin: 0.9,
    radiusMetres: 10,
    innerMetres: 4,
  },
};

// What the view is: RVT's combined VAT (`VAT_combined.py`), the general stack
// laid over the flat one at half opacity, which over single-band data is their
// mean. Neither alone is offered. General goes flat on gentle ground and flat
// oversaturates on steep, and a reader choosing between them is being asked to
// classify the terrain before looking at it — which is the thing they came to
// the picture to do.
export const VAT_GENERAL_OPACITY = 0.5;

// VAT's sun is frozen and the exaggeration is 1×, against this app's own
// z-factor 2 default: the slope layer is normalised against a fixed 0–50° and
// the hillshade against 0–1, so exaggerating first pushes both off the range
// the blend was tuned on, and a moving sun makes two VAT renders incomparable.
export const VAT_AZIMUTH = 315;
export const VAT_Z_FACTOR = 1;

// The surface VAT is computed on — all four layers, not just the horizon scan.
// RVT reads every layer of the stack off one grid, and the stretches are
// calibrated together on that one grid: hand the slope layer a surface twice as
// fine as the openness layer and the composite is a sharp hillshade with a
// blurred wash over it, which is not what 68–93° was tuned against. 0.5 m is
// the resolution RVT used, and the point past which a 0.25 m laser surface
// contributes grain rather than ground: scanning the same scene at 0.25 m
// instead bought 5 % more contrast across a ditch and, with 3 cm of noise in
// the DEM, nearly doubled the speckle on featureless ground. A 0.5 m cell also
// halves the slope layer's sensitivity to that noise — 3 cm over a two-cell
// baseline is 3.4° at 0.25 m against 1.7° at 0.5 m, and the flat preset's whole
// slope stretch is 15°.
export const VAT_SCAN_M_PER_PX = 0.5;

// Two scans over this many cells is around three seconds of walking, which is
// what a kilometre-wide rectangle has to be coarsened to fit. Without a ceiling
// the finest grid the rule above asks for would freeze the tab for half a
// minute on one.
const VAT_MAX_SCAN_CELLS = 1_200_000;

/**
 * How far VAT decimates before computing anything, given the grid's extent in
 * metres. Takes metres rather than a `Dem` so a figure caption can reach the
 * same answer from a stored bbox, and so the number on the legend is the number
 * the pixels were read at.
 */
export const vatDecimation = (
  widthMetres: number,
  heightMetres: number,
  metresPerPx: number,
): number => {
  const finest = Math.max(1, Math.round(VAT_SCAN_M_PER_PX / metresPerPx));
  // The cell size that puts this rectangle exactly on the budget.
  const affordable = Math.sqrt((widthMetres * heightMetres) / VAT_MAX_SCAN_CELLS);
  return Math.max(finest, Math.ceil(affordable / metresPerPx), 1);
};

/**
 * One layer of a VAT blend. Named because the cached ground (`cvatGround.ts`)
 * describes its own stack in the same vocabulary, and the legend prints both
 * through `figure.set.vatLayer`.
 */
export type VatStackLayer = {
  vis: Visualization;
  blend: 'normal' | 'luminosity' | 'overlay' | 'multiply';
  opacity: number;
};

/**
 * What `composeVat` blends, as data, for the figure legend to read. The
 * compositor does not consume it — four lines of arithmetic read better written
 * out than driven off a table — so the two have to move together, and this
 * table exists to make a legend that has drifted from the blend obvious. The
 * stretches are not here because they are the half that differs per preset.
 *
 * Openness reads 100 % where `settings/blender_VAT.json` says 50, because 100 %
 * is what RVT performs. `rvt.blend_func.blend_overlay` writes its result into
 * the background array it was handed and returns that same array, so the
 * caller's `render_images(top, background, opacity)` in `rvt/blend.py` mixes
 * the blended layer with itself and the opacity does nothing. Multiply and
 * screen allocate, so the sky-view layer's 25 % survives; only overlay and soft
 * light are eaten. Every published VAT image and every RVT plugin output an
 * archaeologist has calibrated an eye against came out of that path, so the
 * settings file is the wrong half of RVT to copy: honouring its 50 % cost about
 * 40 % of the composite's local contrast, which is most of what makes a low
 * bank visible at all.
 */
export const VAT_STACK: readonly VatStackLayer[] = [
  { vis: 'hillshade', blend: 'normal', opacity: 100 },
  { vis: 'slope', blend: 'luminosity', opacity: 50 },
  { vis: 'openPos', blend: 'overlay', opacity: 100 },
  { vis: 'svf', blend: 'multiply', opacity: 25 },
];

const norm = (v: number, lo: number, hi: number): number => {
  const t = (v - lo) / (hi - lo);
  return t < 0 ? 0 : t > 1 ? 1 : t;
};

// rvt.blend_func.blend_overlay, which drives off the *background* rather than
// the active layer.
const overlay = (active: number, background: number): number =>
  background > 0.5
    ? 1 - (1 - 2 * (background - 0.5)) * (1 - active)
    : 2 * background * active;

/**
 * Composite one preset's four VAT layers. Inputs are the raw fields in their
 * own units — hillshade 0..1, slope in radians, positive openness in degrees,
 * sky-view 0..1 — and the result is 0..1, so it paints through the plain grey
 * ramp with no stretch. Two of RVT's three blend modes collapse over
 * single-band data: a luminosity blend is the active layer, and opacity is a
 * plain linear mix (`active·o + background·(1−o)`). Only overlay keeps its
 * arithmetic, and it carries no mix at all — see VAT_STACK for why.
 */
export function composeVat(
  hillshade: Float32Array,
  slopeRadians: Float32Array,
  openPosDegrees: Float32Array,
  svf: Float32Array,
  preset: VatPreset,
): Float32Array {
  const out = new Float32Array(hillshade.length).fill(NaN);
  const toDeg = 180 / Math.PI;

  for (let i = 0; i < out.length; i++) {
    const hs = hillshade[i];
    const sl = slopeRadians[i];
    const op = openPosDegrees[i];
    const sv = svf[i];
    if (
      Number.isNaN(hs) ||
      Number.isNaN(sl) ||
      Number.isNaN(op) ||
      Number.isNaN(sv)
    ) {
      continue;
    }

    // Slope renders inverted: steep is dark.
    let p = 0.5 * (1 - norm(sl * toDeg, 0, preset.slopeMax)) + 0.5 * hs;
    const o = norm(op, preset.opennessMin, preset.opennessMax);
    p = overlay(o, p);
    const v = norm(sv, preset.svfMin, 1);
    p = 0.25 * (v * p) + 0.75 * p;

    out[i] = p < 0 ? 0 : p > 1 ? 1 : p;
  }
  return out;
}

/**
 * Combined VAT: one gradient walk, one slope, two suns and two horizon scans,
 * every one of them on the grid `vatDecimation` imposes. Only the finished
 * composite is interpolated back to the DEM's own resolution, so no layer is
 * blended against a sharper or blurrier version of the same ground than RVT
 * would have blended it against, and the legend can name one resolution for
 * the whole picture. The two presets differ only in their stretches, their sun
 * and how far along the ray they look.
 */
export function computeVat(dem: Dem): Float32Array {
  const factor = vatDecimation(
    dem.width * dem.metresPerPx,
    dem.height * dem.metresPerPx,
    dem.metresPerPx,
  );
  const grid: Grid = factor === 1 ? dem : decimate(dem, factor);
  const { dzdx, dzdy } = gradients(grid);
  const slope = slopeFromGradients(dzdx, dzdy, VAT_Z_FACTOR);

  const stack = (terrain: VatTerrain): Float32Array => {
    const preset = VAT_PRESETS[terrain];
    const horizon = scanHorizon(grid, preset.radiusMetres, preset.innerMetres);
    return composeVat(
      shadeFromGradients(
        dzdx,
        dzdy,
        VAT_AZIMUTH,
        preset.sunAltitude,
        VAT_Z_FACTOR,
      ),
      slope,
      horizon.openPos,
      horizon.svf,
      preset,
    );
  };

  const general = stack('general');
  const flat = stack('flat');
  const combined = new Float32Array(general.length).fill(NaN);
  for (let i = 0; i < combined.length; i++) {
    if (Number.isNaN(general[i]) || Number.isNaN(flat[i])) continue;
    combined[i] =
      VAT_GENERAL_OPACITY * general[i] + (1 - VAT_GENERAL_OPACITY) * flat[i];
  }
  if (factor === 1) return combined;
  return upsample(combined, grid, dem.width, dem.height, factor, dem.data);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Robust range for a stretch. Min/max is useless here: one no-data-adjacent
// spike flattens everything else into a couple of grey levels.
export function percentileRange(
  values: Float32Array,
  lowPct: number,
  highPct: number,
): [number, number] {
  const finite: number[] = [];
  // Percentiles of a 1-in-N sample are indistinguishable at this precision.
  const stride = Math.max(1, Math.floor(values.length / 200000));
  for (let i = 0; i < values.length; i += stride) {
    const v = values[i];
    if (Number.isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) return [0, 1];
  finite.sort((a, b) => a - b);
  const at = (p: number) =>
    finite[
      Math.min(
        finite.length - 1,
        Math.max(0, Math.round(p * (finite.length - 1))),
      )
    ];
  const lo = at(lowPct);
  const hi = at(highPct);
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

export type Ramp = 'grey' | 'greyInverted' | 'diverging';

// Paint a computed field into RGBA. No-data goes fully transparent, so a
// coverage edge reads as a hole rather than as black ground.
export function toImageData(
  values: Float32Array,
  width: number,
  height: number,
  ramp: Ramp,
  range: [number, number],
): ImageData {
  const img = new ImageData(width, height);
  const px = img.data;
  const [lo, hi] = range;
  const span = hi - lo || 1;

  for (let i = 0; i < values.length; i++) {
    const o = i * 4;
    const v = values[i];
    if (!Number.isFinite(v)) {
      px[o + 3] = 0;
      continue;
    }
    let t = (v - lo) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;

    if (ramp === 'diverging') {
      // Centre the neutral tone on zero, not on the midpoint of the range, so
      // "no local relief" is the same colour across renders.
      const mid = (0 - lo) / span;
      const [r, g, b] = divergingColor(t, mid < 0 ? 0 : mid > 1 ? 1 : mid);
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
    } else {
      const g = Math.round((ramp === 'greyInverted' ? 1 - t : t) * 255);
      px[o] = g;
      px[o + 1] = g;
      px[o + 2] = g;
    }
    px[o + 3] = 255;
  }
  return img;
}

// Brown (below) → near-white (at zero) → blue-green (above), rather than the
// usual red/blue, so it stays legible for the red-green colour blind.
function divergingColor(t: number, mid: number): [number, number, number] {
  if (t < mid) {
    const k = mid > 0 ? t / mid : 0;
    return [
      Math.round(120 + k * 128),
      Math.round(72 + k * 176),
      Math.round(38 + k * 210),
    ];
  }
  const k = mid < 1 ? (t - mid) / (1 - mid) : 0;
  return [
    Math.round(248 - k * 220),
    Math.round(248 - k * 130),
    Math.round(248 - k * 90),
  ];
}
