/*
 * Provenance figures: an image plus everything needed to say what it is a
 * picture of, who owns it, and exactly how it was made.
 *
 * Every raster this app keeps or hands out goes through here first. That is
 * not decoration — a relief render is an *interpretation* of the ground, and
 * a hillshade at 315°/35° and one at 135°/20° disagree about whether there is
 * a mound in the field. A figure that does not carry its own azimuth cannot
 * be checked by anyone, which is the difference between a picture and
 * evidence. Reporting a find to Riksantikvaren or to a county archaeologist
 * means handing over the second kind.
 *
 * What lands on the file:
 *
 *   - the image, whole and untouched — the caption is a matte *below* it, so
 *     no pixel of ground is covered. The cost is that the file is no longer
 *     pixel-registered to its bbox, so `imageRect` in the attachment meta
 *     records where the image sits inside it;
 *   - a scale bar and a north arrow, on the image, cased so they read on
 *     black relief and white ortofoto alike;
 *   - source, acquisition, processing settings, EPSG:25833 extent, geodetic
 *     centre, resolution, rights holder and licence, and when it was made.
 *
 * Spec builders per producer are in `./specs`; the canvas work is in
 * `./draw`.
 */

import { transform } from 'ol/proj';
import i18n, { t } from 'i18next';
import {
  type CaptionRow,
  dec,
  drawNorthArrow,
  drawScaleBar,
  ensureFigureFont,
  figureFontSize,
  int,
  joinDot,
  layoutCaption,
  MATTE,
} from './draw';

/**
 * A rights holder that has to be named on the figure. `holder` is a proper
 * name and is never translated; `termsKey` resolves to the licence or terms
 * line, which is.
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
  /**
   * Ortofoto. Not open data: the app's flyfoto notice says the same thing at
   * grab time, and this is that sentence following the image out of the app.
   */
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

export type FigureSpec = {
  /** Bold first line: what this is a picture of. */
  title: string;
  /** The dataset, named the way its register names it. */
  source: string;
  /** Which acquisition: project, year, photo date, point density. */
  acquisition?: string;
  /** How the picture was made. One already-formatted phrase per setting. */
  settings: string[];
  /** The ground the image covers. */
  bbox25833: [number, number, number, number];
  metresPerPx: number;
  credits: Credit[];
  /** See NorthArrowOptions. Zero for everything but a rotated screenshot. */
  rotation?: number;
  /** Defaults to now. */
  produced?: Date;
};

/**
 * A caption needs room to be a caption. Below this the text wraps so hard
 * that the block ends up taller than the picture, so the image is matted
 * instead — which is also what a small figure looks like on a page.
 */
const MIN_FIGURE_WIDTH = 560;

/** Where the image sits inside the figure. Recorded in the attachment meta. */
export type ImageRect = { x: number; y: number; width: number; height: number };

export type Figure = { canvas: HTMLCanvasElement; imageRect: ImageRect };

const centreLatLon = (bbox25833: [number, number, number, number]): string => {
  const [minX, minY, maxX, maxY] = bbox25833;
  try {
    const [lon, lat] = transform(
      [(minX + maxX) / 2, (minY + maxY) / 2],
      'EPSG:25833',
      'EPSG:4326',
    );
    // Norwegian hemisphere letters in every locale, like the rest of the
    // app's coordinate readouts — they are read against Norwegian maps.
    return `${dec(lat, 5)}° N, ${dec(lon, 5)}° Ø`;
  } catch {
    return '';
  }
};

const captionRows = (
  spec: FigureSpec,
  width: number,
  height: number,
): CaptionRow[] => {
  const [minX, minY, maxX, maxY] = spec.bbox25833;
  const produced = spec.produced ?? new Date();
  return [
    { text: spec.title },
    {
      label: t('figure.label.source'),
      text: joinDot([spec.source, spec.acquisition]),
    },
    {
      label: t('figure.label.method'),
      text: spec.settings.join(' · '),
    },
    {
      label: t('figure.label.area'),
      text: joinDot([
        'EPSG:25833',
        `Ø ${int(minX)}–${int(maxX)}`,
        `N ${int(minY)}–${int(maxY)}`,
        `${int(maxX - minX)} × ${int(maxY - minY)} m`,
      ]),
    },
    {
      label: t('figure.label.image'),
      text: joinDot([
        `${width} × ${height} px`,
        `${dec(spec.metresPerPx, 2)} m/px`,
        centreLatLon(spec.bbox25833),
      ]),
    },
    {
      label: t('figure.label.rights'),
      text: spec.credits
        .map((c) => `© ${c.holder} (${t(c.termsKey)})`)
        .join(' · '),
    },
    {
      label: t('figure.label.produced'),
      text: `${t('figure.app')} · ${new Intl.DateTimeFormat(i18n.language || 'nb', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(produced)}`,
    },
  ];
};

/**
 * Image + spec → the figure. Never throws and never returns a smaller image
 * than it was given: if a context cannot be obtained the source canvas comes
 * straight back, because losing the picture to save the caption would be the
 * wrong trade every time.
 */
export const renderFigure = async (
  image: HTMLCanvasElement,
  spec: FigureSpec,
): Promise<Figure> => {
  const bare: Figure = {
    canvas: image,
    imageRect: { x: 0, y: 0, width: image.width, height: image.height },
  };
  if (image.width === 0 || image.height === 0) return bare;

  const width = Math.max(MIN_FIGURE_WIDTH, image.width);
  const fontSize = figureFontSize(width);
  await ensureFigureFont(fontSize);

  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return bare;
  const caption = layoutCaption(
    measure,
    captionRows(spec, image.width, image.height),
    width,
    fontSize,
  );

  const out = document.createElement('canvas');
  out.width = width;
  out.height = image.height + caption.height;
  const ctx = out.getContext('2d');
  if (!ctx) return bare;

  const dx = Math.round((width - image.width) / 2);
  if (dx > 0) {
    ctx.fillStyle = MATTE;
    ctx.fillRect(0, 0, width, image.height);
  }
  ctx.drawImage(image, dx, 0);

  const inset = Math.round(fontSize * 0.8);
  drawScaleBar(ctx, {
    x: dx + inset,
    bottom: image.height - inset,
    width: image.width,
    metresPerPx: spec.metresPerPx,
    fontSize,
  });
  const radius = Math.round(Math.max(22, fontSize * 1.5));
  // Skipped rather than squeezed: on an image too small to hold it, an arrow
  // overlapping the scale bar reads as a mistake, and "which way is up" is
  // the one thing a north-up raster can afford to leave implicit.
  if (image.width > radius * 6 && image.height > radius * 6) {
    drawNorthArrow(ctx, {
      cx: dx + image.width - inset - radius,
      cy: inset + radius,
      radius,
      rotation: spec.rotation ?? 0,
    });
  }

  caption.draw(ctx, image.height);

  return {
    canvas: out,
    imageRect: { x: dx, y: 0, width: image.width, height: image.height },
  };
};

export const figureBlob = (
  canvas: HTMLCanvasElement,
  type: 'image/png' | 'image/jpeg' = 'image/png',
  quality?: number,
): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/** The whole path, for the callers that only want bytes. */
export const renderFigureBlob = async (
  image: HTMLCanvasElement,
  spec: FigureSpec,
  type: 'image/png' | 'image/jpeg' = 'image/png',
  quality?: number,
): Promise<{ blob: Blob; imageRect: ImageRect } | null> => {
  const figure = await renderFigure(image, spec);
  const blob = await figureBlob(figure.canvas, type, quality);
  return blob ? { blob, imageRect: figure.imageRect } : null;
};
