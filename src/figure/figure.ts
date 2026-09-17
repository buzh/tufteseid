// Provenance legends: the image plus what it is a picture of, who owns the
// data and who made the picture — a hillshade at 315°/35° and one at 135°/20°
// disagree about whether there is a mound in that field, so a render without
// its own azimuth cannot be checked by anyone.
//
// Nothing stored carries a legend. What PocketBase holds is the bare raster,
// pixel-registered to its bbox, and the provenance lives beside it in the
// record's `meta`; the legend is stamped on the way out, by whoever asked for
// a file. That is why it comes out in the reader's language and the current
// wording rather than whatever was true when the pin ran, and why the map can
// lay a kept View on the ground without a caption card riding along.
//
// The rights line has two halves. Everything upstream is credited by the part
// it plays in *this* picture — the same holder is `høydedata` under a terrain
// render and `skyggerelieff` under a LiDAR extract, and that difference is
// precisely the statement about who did the visualising. Where the picture was
// made here rather than fetched whole, the author and the app are named as its
// co-authors.

import { transform } from 'ol/proj';
import { t } from 'i18next';
import {
  dec,
  drawLegend,
  drawNorthArrow,
  ensureFigureFont,
  joinDot,
  legendFontSize,
  type LegendRow,
} from './draw';

/**
 * A rights holder named on the legend. `holder` is a proper name and is never
 * translated; `termsKey` resolves to the licence line, which is.
 */
export type Credit = { holder: string; termsKey: string };

export const CREDITS = {
  /** Kartverket's height data — the LiDAR WMS and the hoydedata.no DEMs. */
  hoydedata: {
    holder: 'Kartverket',
    termsKey: 'figure.terms.ccby',
  },
  /** Topographic map, place names, the WMTS basemaps. */
  kartverket: {
    holder: 'Kartverket',
    termsKey: 'figure.terms.ccby',
  },
  /** Ortofoto. Not open data; the notice follows the image out. */
  nib: {
    holder: 'Norge i bilder — Kartverket, Geovekst, NIBIO og kommunene',
    termsKey: 'figure.terms.nib',
  },
  /** The Kulturminner theme layers. */
  riksantikvaren: {
    holder: 'Riksantikvaren',
    termsKey: 'figure.terms.ccby',
  },
} as const satisfies Record<string, Credit>;

/**
 * An upstream dataset and the part it plays here. `roleKey` resolves through
 * `figure.role.*`: what the pixels are made of, not who made them.
 */
export type SourceCredit = { roleKey: string; credit: Credit };

/**
 * The picture's own authorship, present only where the app made it rather than
 * fetched it. `roleKey` says which act — `visualisering`, `tegning`,
 * `sammenstilling`. The terms are not negotiable: using this tool is agreeing
 * to publish what it makes for you under CC BY 4.0, which is what lets a
 * reading be quoted and argued with.
 */
export type AuthoredCredit = { roleKey: string; author: string };

const AUTHORED_TERMS_KEY = 'figure.terms.ccby';

export type FigureSpec = {
  /** Bold first line: what this is a picture of. */
  title: string;
  /** The dataset, named the way its register names it. */
  source: string;
  /** Which acquisition: project, year, photo date, point density. */
  acquisition?: string;
  /** How the picture was made. One already-formatted phrase per setting. */
  settings: string[];
  /** The ground the image covers; the legend prints its centre. */
  bbox25833: [number, number, number, number];
  metresPerPx: number;
  credits: SourceCredit[];
  /** Absent where every pixel came from upstream untouched. */
  authored?: AuthoredCredit;
  /** See NorthArrowOptions. Zero for everything but a rotated screenshot. */
  rotation?: number;
  /**
   * Where the map sits inside the stored file, in that file's own pixels.
   * Present only on a record pinned while the caption panel was still burned
   * in below the map: the stamp trims to this first, or the plate lands on top
   * of the old panel and the file goes out saying everything twice. Absent
   * means the whole file is map, which is what every producer writes now.
   * `groundView.cropOf` reads the same field to place those pixels on the map.
   */
  crop?: { x: number; y: number; width: number; height: number };
};

// What the store will take. `attachments.file` caps a raster at 50 MB and one
// that does not fit is no image at all: PocketBase answers 400 and every retry
// fails the same way. The fit lives here rather than in each producer so no
// producer can record a resolution it did not write — `fitImageBlob` reports
// the one it achieved. The pixel budget is the rule, the byte budget the
// backstop: encoded size spreads ~250× across content, so it is measured
// rather than predicted.
const MAX_STORED_PIXELS = 40_000_000;
const MAX_STORED_BYTES = 50_000_000;

// The geometric step converges in one pass from any plausible start; the cap is
// so a pathological encoder cannot spin the queue.
const MAX_FIT_PASSES = 3;

// Only ever used to fit the store; a stamp keeps the pixels it was handed.
const scaleCanvas = (
  src: HTMLCanvasElement,
  factor: number,
): HTMLCanvasElement => {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(src.width * factor));
  out.height = Math.max(1, Math.round(src.height * factor));
  const ctx = out.getContext('2d');
  // Too large to store beats gone, and the byte check reports on what it gets.
  if (!ctx) return src;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
};

const canvasBlob = (
  canvas: HTMLCanvasElement,
  type: 'image/png' | 'image/jpeg' = 'image/png',
  quality?: number,
): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Bare pixels, fitted to the store. The producers' path: what comes back is
 * the raster edge to edge, registered to the bbox the caller rendered, with no
 * furniture on it at all. `metresPerPx` comes back because it may not be the
 * one that went in — the fit can downscale, and the record has to say what is
 * actually in the file.
 */
export const fitImageBlob = async (
  image: HTMLCanvasElement,
  metresPerPx: number,
  type: 'image/png' | 'image/jpeg' = 'image/png',
  quality?: number,
): Promise<{ blob: Blob; metresPerPx: number } | null> => {
  if (image.width === 0 || image.height === 0) return null;
  const pixels = image.width * image.height;
  let source =
    pixels > MAX_STORED_PIXELS
      ? scaleCanvas(image, Math.sqrt(MAX_STORED_PIXELS / pixels))
      : image;

  for (let pass = 0; ; pass++) {
    const blob = await canvasBlob(source, type, quality);
    if (!blob) return null;
    if (blob.size <= MAX_STORED_BYTES || pass === MAX_FIT_PASSES) {
      // Ratio of widths rather than the factor applied, so the rounding
      // `scaleCanvas` did is included instead of being asserted away.
      return { blob, metresPerPx: (metresPerPx * image.width) / source.width };
    }
    // Bytes do not fall as fast as pixels, so the step takes a margin.
    source = scaleCanvas(source, Math.sqrt(MAX_STORED_BYTES / blob.size) * 0.95);
  }
};

const centreLatLon = (bbox25833: [number, number, number, number]): string => {
  const [minX, minY, maxX, maxY] = bbox25833;
  try {
    const [lon, lat] = transform(
      [(minX + maxX) / 2, (minY + maxY) / 2],
      'EPSG:25833',
      'EPSG:4326',
    );
    // Norwegian hemisphere letters in every locale, like the app's other
    // coordinate readouts.
    return `${dec(lat, 4)}° N, ${dec(lon, 4)}° Ø`;
  } catch {
    return '';
  }
};

const rightsLine = (role: string, holder: string, termsKey: string): string =>
  t('figure.rights.line', { role, holder, terms: t(termsKey) });

/**
 * The plate's lines. The exact extent, the pixel dimensions and the render
 * clock are deliberately not here: the first two are in the record's `meta`
 * and in the Rapportpakke's front page, and the third is a fact about a job
 * rather than about the ground.
 */
const legendRows = (spec: FigureSpec): LegendRow[] => {
  const rows: LegendRow[] = [{ text: spec.title, kind: 'title' }];
  const source = joinDot([spec.source, spec.acquisition]);
  if (source) rows.push({ text: source, kind: 'body' });
  if (spec.settings.length > 0) {
    rows.push({ text: spec.settings.join(' · '), kind: 'body' });
  }
  rows.push({
    text: joinDot([centreLatLon(spec.bbox25833), `${dec(spec.metresPerPx, 2)} m/px`]),
    kind: 'body',
  });
  // One row per holder rather than one joined row: NiB's name alone is sixty
  // characters, and a list that wraps into itself is unreadable.
  for (const { roleKey, credit } of spec.credits) {
    rows.push({
      text: rightsLine(t(roleKey), credit.holder, credit.termsKey),
      kind: 'rights',
    });
  }
  if (spec.authored) {
    rows.push({
      text: rightsLine(
        t(spec.authored.roleKey),
        t('figure.rights.authors', {
          author: spec.authored.author,
          app: t('figure.app'),
        }),
        AUTHORED_TERMS_KEY,
      ),
      kind: 'rights',
    });
  }
  return rows;
};

/**
 * The plate, drawn onto the canvas in place. Never throws and never resizes:
 * the plate is inside the picture, so a stamped file is still pixel-registered
 * to its bbox and can be read as a map.
 */
const stampOnto = async (
  image: HTMLCanvasElement,
  spec: FigureSpec,
): Promise<void> => {
  const ctx = image.getContext('2d');
  // A picture with no legend beats no picture.
  if (!ctx) return;

  const fontSize = legendFontSize(image.width);
  await ensureFigureFont(fontSize);

  // Only a rotated screenshot earns one: every stitched raster is north-up in
  // EPSG:25833, and an arrow that is always the same is furniture, not a fact.
  const rotation = spec.rotation ?? 0;
  if (rotation !== 0) {
    const radius = Math.round(Math.max(22, fontSize * 1.5));
    if (image.width > radius * 6 && image.height > radius * 6) {
      const inset = Math.round(fontSize * 0.9);
      drawNorthArrow(ctx, {
        cx: image.width - inset - radius,
        cy: inset + radius,
        radius,
        rotation,
      });
    }
  }

  drawLegend(ctx, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
    rows: legendRows(spec),
    metresPerPx: spec.metresPerPx,
    fontSize,
  });
};

const decodeToCanvas = async (
  blob: Blob,
): Promise<HTMLCanvasElement | null> => {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
};

// The map out of a file that has something else below it. Clamped to the
// source, and a rect that is the whole image or degenerate is no crop at all:
// the canvas comes back as it went in.
const cropCanvas = (
  src: HTMLCanvasElement,
  crop: { x: number; y: number; width: number; height: number },
): HTMLCanvasElement => {
  const x = Math.max(0, Math.round(crop.x));
  const y = Math.max(0, Math.round(crop.y));
  const width = Math.min(Math.round(crop.width), src.width - x);
  const height = Math.min(Math.round(crop.height), src.height - y);
  if (width < 1 || height < 1) return src;
  if (x === 0 && y === 0 && width === src.width && height === src.height) {
    return src;
  }
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) return src;
  ctx.drawImage(src, x, y, width, height, 0, 0, width, height);
  return out;
};

/**
 * Stored bytes → the bytes that leave the app. The whole of the "legend on the
 * way out" arrangement lands here: every download, every takeout entry and
 * every kept proposal goes through it, and a `null` spec — an upload, or a
 * record too old to describe itself — passes the original blob through
 * untouched rather than inventing a caption for it.
 *
 * Re-encodes in the type it was given, so a JPEG stitch does not come back as
 * a PNG four times the size. Failure is not fatal: the unstamped file is worse
 * than the stamped one but far better than none.
 */
export const stampBlob = async (
  blob: Blob,
  spec: FigureSpec | null,
): Promise<Blob> => {
  if (!spec) return blob;
  try {
    const decoded = await decodeToCanvas(blob);
    if (!decoded) return blob;
    const canvas = spec.crop ? cropCanvas(decoded, spec.crop) : decoded;
    await stampOnto(canvas, spec);
    const jpeg = blob.type === 'image/jpeg';
    const out = await canvasBlob(
      canvas,
      jpeg ? 'image/jpeg' : 'image/png',
      jpeg ? 0.9 : undefined,
    );
    return out ?? blob;
  } catch (e) {
    console.warn('[figure] stamp failed', e);
    return blob;
  }
};
