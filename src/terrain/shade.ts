// Relief visualizations computed from a float DEM (see dem.ts).
//
// Why these five: a single-azimuth hillshade hides every feature running
// parallel to the light, which for earthwork spotting is its defining flaw —
// a ditch lit end-on disappears. The illumination-independent visualizations
// (sky-view factor, local relief) are what archaeological prospection
// actually leans on; see docs/terrain-analysis.md for the references.
//
// Each compute* returns a Float32Array in the DEM's own grid, NaN where the
// DEM has no coverage, and is deliberately separate from rendering so the
// UI can cache an expensive pass (SVF) while scrubbing a cheap one
// (hillshade azimuth).

import type { Dem } from './dem';

export type Visualization =
  | 'hillshade'
  | 'multiHillshade'
  | 'slope'
  | 'lrm'
  | 'svf';

// Azimuths for the multidirectional blend, with weights.
//
// Both parts are load-bearing. The azimuths span only three quadrants and
// the weights peak at 315°, which keeps a net light direction from the
// north-west (the cartographic convention, and what makes relief read as
// relief rather than as a slope map). Meanwhile no direction is left
// unlit, which is the whole point: a linear feature running parallel to a
// single light source is invisible under it.
//
// Evenly spaced azimuths at equal weight do NOT work here, and the failure
// is silent. The directional term cos(azimuth - aspect) then sums to zero
// by symmetry and the blend collapses to cos(zenith)·cos(slope) — a slope
// map. Measured on a 1 m Oslo DEM the giveaway was a maximum of exactly
// 0.7071 = cos(45°), i.e. no cell anywhere brighter than flat ground.
const MULTI_AZIMUTHS = [
  { azimuth: 225, weight: 3 },
  { azimuth: 270, weight: 4 },
  { azimuth: 315, weight: 5 },
  { azimuth: 360, weight: 4 },
  { azimuth: 45, weight: 3 },
  { azimuth: 90, weight: 2 },
];

// Sky-view factor cost is width × height × directions × radius. 16 is the
// usual compromise in the literature — 8 leaves visible directional
// banding, 32 doubles the cost for little gain.
const SVF_DIRECTIONS = 16;

// Hard ceiling on the SVF search radius in *pixels*, whatever the metre
// value works out to. Keeps a fine-resolution DEM from turning a 3-second
// pass into a 30-second one.
const SVF_MAX_RADIUS_PX = 24;

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

// Horn's 3×3 method, the same one GDAL and Esri use. Returns partial
// derivatives in metres per metre. NaN anywhere in the neighbourhood
// poisons the cell — better a hole than an invented slope at a coverage
// edge, where the drop to no-data would read as a cliff.
function gradients(dem: Dem): { dzdx: Float32Array; dzdy: Float32Array } {
  const { width: w, height: h, data, metresPerPx } = dem;
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
// (315 = north-west, the cartographic convention); `altitude` is degrees
// above the horizon.
export function computeHillshade(
  dem: Dem,
  azimuth: number,
  altitude: number,
  zFactor = 1,
): Float32Array {
  const { dzdx, dzdy } = gradients(dem);
  return shadeFromGradients(dzdx, dzdy, azimuth, altitude, zFactor);
}

// Weighted blend of six hillshades. Costs one gradient pass and six cheap
// trig passes, not six full recomputes.
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
    const aspect = gx !== 0 ? Math.atan2(gy, -gx) : gy > 0 ? Math.PI / 2 : gy < 0 ? -Math.PI / 2 : 0;
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

// Hesse's local relief model: the DEM minus a smoothed copy of itself, which
// removes the landform-scale trend and leaves the small stuff standing out —
// exactly the scale that earthworks live at. Output is signed metres.
//
// `radiusMetres` sets what counts as "landform scale": it must be
// comfortably larger than the features you're hunting, or the smoothing eats
// them too.
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

// Three box passes approximate a Gaussian closely enough here and stay O(n)
// per pass via a running sum. NaN-aware: no-data cells contribute nothing
// and don't drag their neighbours toward zero.
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
// Sky-view factor
// ---------------------------------------------------------------------------

// The proportion of the sky hemisphere visible from each cell (Zakšek,
// Oštir & Kokalj 2011). Independent of any light direction, so nothing hides
// because of its orientation: hollows and ditches go dark, banks and mounds
// go bright, and it reads the same whichever way a feature runs.
//
// Cost is width × height × 16 directions × radius, all of it cache-hostile
// pointer chasing. Expect seconds on a large lokalitet — the caller should
// cache the result and only recompute when the radius changes.
export function computeSvf(dem: Dem, radiusMetres: number): Float32Array {
  const { width: w, height: h, data, metresPerPx } = dem;
  const radiusPx = Math.min(
    SVF_MAX_RADIUS_PX,
    Math.max(1, Math.round(radiusMetres / metresPerPx)),
  );

  // Precompute the ray offsets once rather than per pixel.
  const rays: Array<Array<{ off: number; dx: number; dy: number; dist: number }>> =
    [];
  for (let d = 0; d < SVF_DIRECTIONS; d++) {
    const angle = (2 * Math.PI * d) / SVF_DIRECTIONS;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const steps: Array<{ off: number; dx: number; dy: number; dist: number }> =
      [];
    let lastOff: number | null = null;
    for (let r = 1; r <= radiusPx; r++) {
      const dx = Math.round(ux * r);
      const dy = Math.round(uy * r);
      const off = dy * w + dx;
      // Near the origin successive steps can round to the same cell; skip
      // the duplicates instead of sampling them twice.
      if (off === lastOff) continue;
      lastOff = off;
      steps.push({ off, dx, dy, dist: Math.hypot(dx, dy) * metresPerPx });
    }
    rays.push(steps);
  }

  const out = new Float32Array(w * h).fill(NaN);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const z0 = data[i];
      if (Number.isNaN(z0)) continue;

      let sum = 0;
      for (let d = 0; d < SVF_DIRECTIONS; d++) {
        let maxTan = 0;
        for (const s of rays[d]) {
          const nx = x + s.dx;
          const ny = y + s.dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) break;
          const z = data[i + s.off];
          if (Number.isNaN(z)) continue;
          const tan = (z - z0) / s.dist;
          if (tan > maxTan) maxTan = tan;
        }
        // 1 - sin(horizon angle); a flat horizon contributes a full 1.
        sum += 1 - maxTan / Math.hypot(1, maxTan);
      }
      out[i] = sum / SVF_DIRECTIONS;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Robust range for a stretch. Min/max is useless on this data: a single
// no-data-adjacent spike, or the flat 0.0 plane the TOPOBATHY service
// returns over water, flattens everything else into a couple of grey levels.
export function percentileRange(
  values: Float32Array,
  lowPct: number,
  highPct: number,
): [number, number] {
  const finite: number[] = [];
  // Sampling keeps this cheap on a multi-megapixel grid; the percentiles of
  // a 1-in-N sample are indistinguishable at this precision.
  const stride = Math.max(1, Math.floor(values.length / 200000));
  for (let i = 0; i < values.length; i += stride) {
    const v = values[i];
    if (Number.isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) return [0, 1];
  finite.sort((a, b) => a - b);
  const at = (p: number) =>
    finite[Math.min(finite.length - 1, Math.max(0, Math.round(p * (finite.length - 1))))];
  const lo = at(lowPct);
  const hi = at(highPct);
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

export type Ramp = 'grey' | 'greyInverted' | 'diverging';

// Paint a computed field into RGBA. No-data goes fully transparent so the
// coverage edge is visible as a hole rather than as black ground.
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
      // Centre the neutral tone on zero rather than on the midpoint of the
      // range, so "no local relief" is always the same colour and the eye
      // can compare two renders.
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

// Brown (below) → near-white (at zero) → blue-green (above). Chosen over the
// usual red/blue so it stays legible for the red-green colour blind, which
// the neutral-through-white midpoint also helps.
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
