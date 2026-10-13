

import type { Dem } from './dem';

type Grid = {
  width: number;
  height: number;
  data: Float32Array;
  metresPerPx: number;
};

export const VISUALIZATIONS = [
  'hillshade',
  'multiHillshade',
  'vat',
  'svf',
  'openPos',
  'openNeg',
  'lrm',
  'slope',
] as const;

export type Visualization = (typeof VISUALIZATIONS)[number];

export const MULTI_AZIMUTHS = [
  { azimuth: 225, weight: 3 },
  { azimuth: 270, weight: 4 },
  { azimuth: 315, weight: 5 },
  { azimuth: 360, weight: 4 },
  { azimuth: 45, weight: 3 },
  { azimuth: 90, weight: 2 },
];

export const SVF_DIRECTIONS = 16;

export const SVF_MAX_RADIUS_PX = 24;

export const HORIZON_MIN_M_PER_PX = 1;

const maxDecimation = (metresPerPx: number): number =>
  Math.max(1, Math.floor(HORIZON_MIN_M_PER_PX / metresPerPx));

export const horizonDecimation = (
  metresPerPx: number,
  radiusMetres: number,
): number =>
  Math.min(
    maxDecimation(metresPerPx),
    Math.max(1, Math.ceil(radiusMetres / (metresPerPx * SVF_MAX_RADIUS_PX))),
  );

export const horizonMaxRadiusMetres = (metresPerPx: number): number =>
  SVF_MAX_RADIUS_PX * metresPerPx * maxDecimation(metresPerPx);

function gradients(grid: Grid): { dzdx: Float32Array; dzdy: Float32Array } {
  const { width: w, height: h, data, metresPerPx } = grid;
  const dzdx = new Float32Array(w * h).fill(NaN);
  const dzdy = new Float32Array(w * h).fill(NaN);
  const denom = 8 * metresPerPx;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;

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

export function computeHillshade(
  dem: Dem,
  azimuth: number,
  altitude: number,
  zFactor = 1,
): Float32Array {
  const { dzdx, dzdy } = gradients(dem);
  return shadeFromGradients(dzdx, dzdy, azimuth, altitude, zFactor);
}

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
    for (let i = 0; i <= radius && i < inner; i++) {
      const v = src[base + i * step];
      if (!Number.isNaN(v)) {
        sum += v;
        count++;
      }
    }
    for (let i = 0; i < inner; i++) {
      if (count > 0) out[base + i * step] = sum / count;
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

export type HorizonFields = {

  svf: Float32Array;

  openPos: Float32Array;

  openNeg: Float32Array;
};

export function computeHorizonFields(
  dem: Dem,
  radiusMetres: number,
): HorizonFields {
  const factor = horizonDecimation(dem.metresPerPx, radiusMetres);
  if (factor === 1) return scanHorizon(dem, radiusMetres, 0);

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

function scanHorizon(
  grid: Grid,
  radiusMetres: number,
  innerMetres: number,
): HorizonFields {
  const { width: w, height: h, data, metresPerPx } = grid;
  const radiusPx = Math.min(
    SVF_MAX_RADIUS_PX,
    Math.max(1, Math.round(radiusMetres / metresPerPx)),
  );

  const innerPx = Math.min(
    radiusPx,
    Math.max(1, Math.round(innerMetres / metresPerPx)),
  );

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

export type VatTerrain = 'general' | 'flat';

export type VatPreset = {

  sunAltitude: number;

  slopeMax: number;

  opennessMin: number;
  opennessMax: number;

  svfMin: number;

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

export const VAT_GENERAL_OPACITY = 0.5;

export const VAT_AZIMUTH = 315;
export const VAT_Z_FACTOR = 1;

export const VAT_SCAN_M_PER_PX = 0.5;

const VAT_MAX_SCAN_CELLS = 1_250_000;

export const vatDecimation = (
  widthMetres: number,
  heightMetres: number,
  metresPerPx: number,
): number => {
  const finest = Math.max(1, Math.round(VAT_SCAN_M_PER_PX / metresPerPx));

  const affordable = Math.sqrt(
    (widthMetres * heightMetres) / VAT_MAX_SCAN_CELLS,
  );
  return Math.max(finest, Math.ceil(affordable / metresPerPx), 1);
};

export type VatStackLayer = {
  vis: Visualization;
  blend: 'normal' | 'luminosity' | 'overlay' | 'multiply';
  opacity: number;
};

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

const overlay = (active: number, background: number): number =>
  background > 0.5
    ? 1 - (1 - 2 * (background - 0.5)) * (1 - active)
    : 2 * background * active;

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

    let p = 0.5 * (1 - norm(sl * toDeg, 0, preset.slopeMax)) + 0.5 * hs;
    const o = norm(op, preset.opennessMin, preset.opennessMax);
    p = overlay(o, p);
    const v = norm(sv, preset.svfMin, 1);
    p = 0.25 * (v * p) + 0.75 * p;

    out[i] = p < 0 ? 0 : p > 1 ? 1 : p;
  }
  return out;
}

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

export function percentileRange(
  values: Float32Array,
  lowPct: number,
  highPct: number,
): [number, number] {
  const finite: number[] = [];

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
