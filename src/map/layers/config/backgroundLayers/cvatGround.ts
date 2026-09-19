// The cached ground: RVT's combined VAT — hillshade, slope, positive openness
// and sky-view in one picture — precomputed over a single LiDAR acquisition and
// written to disk as plain tiles. `vat-cache/build_tiles.py` made them and
// `/cvat/manifest.json` beside them states the presets, the blend order, the
// radii per level and the digest of the run.
//
// Not a service: Caddy's own `file_server` serves the bind-mounted store, so
// there is no proxy route, no wmscache entry and no CSP host — `img-src 'self'`
// already covers it.

import type { VatStackLayer } from '../../../../terrain/shade';
import { XYZBackgroundLayer } from './types';

/**
 * The one acquisition in the store. Byte-identical to the `LidarProject.id` the
 * per-project WMS publishes, which is what lets `chooseAutoDataset` test the
 * footprint against the viewport ranking it already has, with no name mapping
 * and no second coverage source.
 *
 * A constant because there is one. With two the list comes off the manifest.
 */
export const CVAT_ACQUISITION_ID = 'Vestfold og Telemark 5pkt 2021';

/**
 * The levels `build_tiles.py` wrote, on the app's own grid (`wmsTileGrid.ts`):
 * z15 at 0.661 m/px down to z12 at 5.289 m/px. Radii are RVT's own pixels at
 * every level, so the four are related pictures rather than one at four sizes —
 * the reach of the visualization grows as you zoom out.
 */
const CVAT_MIN_ZOOM = 12;
const CVAT_MAX_ZOOM = 15;

/**
 * The store's envelope, 185.6 × 102.9 km, of which the acquisition fills 6 %.
 * As the layer's extent it stops OL asking outside; inside it the 94 % that
 * were never written answer 404, which OL marks errored and leaves
 * transparent — and that transparency is the coverage mask, with the faded
 * mosaic underneath showing through.
 */
const CVAT_COVERAGE_EXTENT_25833: [number, number, number, number] = [
  61055, 6557418, 246691, 6660366,
];

// ---------------------------------------------------------------------------
// What the pixels are, for the provenance plate
// ---------------------------------------------------------------------------
//
// A screenshot over this ground is the one figure the app hands out whose
// relief nobody upstream computed: hoydedata.no served height values and RVT,
// run here, made the picture. The plate has to say both, or the file reads as
// Kartverket's own shading.
//
// The manifest beside the tiles is the authority and carries the rest — the
// stretches, the per-level radii in metres, the encoder, the digest of the run.
// What a legend can print is transcribed here rather than fetched from it: a
// downloaded figure travels off this host, and a plate that could only be
// written while the store answered would be missing from exactly the files that
// leave. `vat-cache/cvat.py` is where these numbers come from.
//
// Not `VAT_STACK` from `terrain/shade.ts`, which transcribes the same RVT
// template for the client-side render. The two agree today; they describe
// different renderers and must stay free to disagree.

/** The renderer and the template, named the way RVT names them. */
export const CVAT_RENDERER = 'RVT';
export const CVAT_TEMPLATE = 'VAT_Combined';

/**
 * The blend, bottom to top. Opacity is what each layer performs at, not what
 * the template names: `rvt.blend_func.blend_overlay` writes through its
 * background, so the manifest's 50 % on the openness layer behaves as 100 % —
 * RVT's own behaviour, left uncorrected in the cache and recorded here as what
 * it does.
 */
export const CVAT_STACK: readonly VatStackLayer[] = [
  { vis: 'hillshade', blend: 'normal', opacity: 100 },
  { vis: 'slope', blend: 'luminosity', opacity: 50 },
  { vis: 'openPos', blend: 'overlay', opacity: 100 },
  { vis: 'svf', blend: 'multiply', opacity: 25 },
];

/**
 * Degrees. Frozen, like the app's own VAT: a moving sun makes two renders
 * incomparable.
 */
export const CVAT_AZIMUTH = 315;

/** Sun height per preset, degrees. */
export const CVAT_SUN_ALTITUDE = { general: 35, flat: 15 } as const;

/**
 * RVT's `max_rad`, in RVT's own pixels and the same number at every level —
 * which is why the four levels are related pictures rather than one picture at
 * four sizes.
 */
export const CVAT_RADIUS_PX = { general: 10, flat: 20 } as const;

/** Percent of the general preset laid over the flat one. */
export const CVAT_GENERAL_OPACITY = 50;

export const CVAT_GROUND_CONFIG: XYZBackgroundLayer = {
  type: 'XYZ',
  layerName: 'lidarCvat',
  url: '/cvat/{z}/{x}/{y}.webp',
  projection: 'EPSG:25833',
  minZoom: CVAT_MIN_ZOOM,
  maxZoom: CVAT_MAX_ZOOM,
  coverageExtent: { extent: CVAT_COVERAGE_EXTENT_25833, crs: 'EPSG:25833' },
};
