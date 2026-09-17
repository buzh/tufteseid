// The drawing half of the provenance legend: a plate in the corner of the
// image carrying what it is a picture of, and the north arrow for the one case
// that needs one. Every dimension derives from the one `fontSize` the caller
// computes from the image width, so a 600 px screenshot and a 4000 px extract
// come out as the same legend. White on a translucent dark plate, because it
// sits on ground that is black in one visualization and white in the next.
//
// Nothing here goes into a stored file. The legend is stamped on the way out —
// see `figure.ts`.

import i18n from 'i18next';

const FAMILY = "'Mulish', system-ui, -apple-system, 'Segoe UI', sans-serif";

const PLATE = 'rgba(10, 12, 14, 0.55)';
const MARK = '#ffffff';
const MARK_DARK = '#14171a';

const locale = () => i18n.language || 'nb';

export const int = (value: number): string =>
  new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(value);

/** Drop the empties and join with the legend's separator. */
export const joinDot = (parts: (string | null | undefined | false)[]): string =>
  parts.filter(Boolean).join(' · ');

export const dec = (value: number, digits: number): string =>
  new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(
    value,
  );

/**
 * Linear in the image width between the two clamps, which keeps the legend a
 * roughly constant fraction of the figure at any raster size.
 */
export const legendFontSize = (width: number): number =>
  Math.round(Math.min(28, Math.max(12, width / 75)));

/**
 * Canvas text does not wait for webfonts — it silently falls through to the
 * next family in the stack, which would make two figures stamped a second
 * apart look different. Covers the cold case only.
 */
export const ensureFigureFont = async (size: number): Promise<void> => {
  const fonts = document.fonts;
  if (!fonts?.load) return;
  try {
    await Promise.all([
      fonts.load(`${size}px Mulish`),
      fonts.load(`700 ${size}px Mulish`),
    ]);
  } catch {
    // A legend in the fallback face beats no legend.
  }
};

const font = (size: number, weight = 400) => `${weight} ${size}px ${FAMILY}`;

const wrap = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] => {
  // Plain spaces only. Intl groups thousands with U+00A0, which `\s` would
  // happily break a coordinate across two lines at.
  const words = text.split(/ +/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const next = `${line} ${words[i]}`;
    if (ctx.measureText(next).width <= maxWidth) line = next;
    else {
      lines.push(line);
      line = words[i];
    }
  }
  lines.push(line);
  return lines;
};

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// ---------------------------------------------------------------------------
// Scale bar
// ---------------------------------------------------------------------------

/** Round down to 1, 2 or 5 × a power of ten. */
const niceMetres = (raw: number): number => {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow;
};

const scaleLabel = (metres: number): string =>
  metres >= 1000 ? `${dec(metres / 1000, 1)} km` : `${int(metres)} m`;

/** Under this the segments are indistinguishable and the bar is left off. */
const MIN_BAR_PX = 24;

type ScaleBar = { metres: number; barPx: number; label: string };

const planScaleBar = (
  metresPerPx: number,
  targetPx: number,
): ScaleBar | null => {
  if (!Number.isFinite(metresPerPx) || metresPerPx <= 0) return null;
  if (!Number.isFinite(targetPx) || targetPx <= 0) return null;
  const metres = niceMetres(targetPx * metresPerPx);
  const barPx = metres / metresPerPx;
  if (!Number.isFinite(barPx) || barPx < MIN_BAR_PX) return null;
  return { metres, barPx, label: scaleLabel(metres) };
};

/** Four alternating segments with the ground distance beside them. */
const paintScaleBar = (
  ctx: CanvasRenderingContext2D,
  bar: ScaleBar,
  x: number,
  y: number,
  barH: number,
  labelSize: number,
) => {
  const seg = bar.barPx / 4;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? MARK : MARK_DARK;
    ctx.fillRect(x + i * seg, y, seg + 0.5, barH);
  }
  ctx.strokeStyle = MARK;
  ctx.lineWidth = Math.max(1, Math.round(labelSize * 0.07));
  ctx.strokeRect(x, y, bar.barPx, barH);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = MARK;
  ctx.font = font(labelSize, 700);
  ctx.fillText(
    bar.label,
    x + bar.barPx + Math.round(labelSize * 0.6),
    y + barH / 2,
  );
};

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

/**
 * One line of the plate before wrapping. `title` is drawn bold; `rights` is
 * the one row that may never be dropped, because it is the only part of the
 * legend the licences actually require.
 */
export type LegendRow = { text: string; kind: 'title' | 'body' | 'rights' };

export type LegendOptions = {
  /** Left edge of the image. */
  x: number;
  /** Top edge of the image. */
  y: number;
  /** Image size — the plate is inset from its bottom-left corner. */
  width: number;
  height: number;
  rows: LegendRow[];
  /** Of the image as it will be written, so the bar measures true. */
  metresPerPx: number;
  fontSize: number;
};

// The plate is sized to its own longest line rather than to the image, so a
// wide raster does not get a legend stretched across it; these bound that.
const PLATE_MAX_FRACTION = 0.55;
const PLATE_MIN_PX = 320;

// The bar targets a fraction of the image, not of the plate: it is a statement
// about the ground, and one that changed with how long the rights line was
// would be a strange thing to measure with.
const BAR_TARGET_FRACTION = 0.22;

type Laid = { lines: string[]; kind: LegendRow['kind'] };

/**
 * Paint the legend into the image's bottom-left corner. Never throws and never
 * touches a pixel outside the plate. Silently does nothing where there is no
 * room, which is the right answer for a thumbnail — a plate covering half the
 * ground is worse than no plate.
 */
export const drawLegend = (
  ctx: CanvasRenderingContext2D,
  { x, y, width, height, rows, metresPerPx, fontSize }: LegendOptions,
): void => {
  const inset = Math.round(fontSize * 0.9);
  const pad = Math.round(fontSize * 0.75);
  const lineH = Math.round(fontSize * 1.3);
  const titleSize = Math.round(fontSize * 1.12);
  const titleLineH = Math.round(titleSize * 1.3);
  const gapAfterTitle = Math.round(fontSize * 0.34);
  const barH = Math.max(5, Math.round(fontSize * 0.42));
  const barGap = Math.round(fontSize * 0.5);

  const avail = width - inset * 2;
  if (avail < PLATE_MIN_PX / 2) return;
  const maxPlate = Math.min(
    avail,
    Math.max(PLATE_MIN_PX, width * PLATE_MAX_FRACTION),
  );

  const fontFor = (kind: LegendRow['kind']) =>
    kind === 'title' ? font(titleSize, 700) : font(fontSize);

  // One pass: measure unwrapped to choose a width, then wrap to it. Wrapping
  // can only shorten a line, so the plate never ends up wider than measured.
  let natural = 0;
  for (const row of rows) {
    if (!row.text) continue;
    ctx.font = fontFor(row.kind);
    natural = Math.max(natural, ctx.measureText(row.text).width);
  }
  const plateW = Math.max(
    Math.min(avail, PLATE_MIN_PX),
    Math.min(maxPlate, Math.ceil(natural) + pad * 2),
  );
  const textW = plateW - pad * 2;

  const bar = planScaleBar(
    metresPerPx,
    Math.min(width * BAR_TARGET_FRACTION, textW),
  );

  const layOut = (source: LegendRow[]): { laid: Laid[]; plateH: number } => {
    const laid: Laid[] = [];
    let plateH = pad * 2 + (bar ? barGap + barH : 0);
    for (const row of source) {
      if (!row.text) continue;
      ctx.font = fontFor(row.kind);
      const lines = wrap(ctx, row.text, textW);
      if (lines.length === 0) continue;
      laid.push({ lines, kind: row.kind });
      plateH +=
        row.kind === 'title'
          ? lines.length * titleLineH + gapAfterTitle
          : lines.length * lineH;
    }
    return { laid, plateH };
  };

  // Shed the body before the plate eats the picture. Title and rights are the
  // floor: what this is, and who it belongs to.
  const maxPlateH = height - inset * 2;
  let { laid, plateH } = layOut(rows);
  if (plateH > maxPlateH) {
    ({ laid, plateH } = layOut(rows.filter((r) => r.kind !== 'body')));
  }
  if (plateH > maxPlateH || laid.length === 0) return;

  const plateX = x + inset;
  const plateY = y + height - inset - plateH;

  ctx.save();
  ctx.fillStyle = PLATE;
  roundRect(ctx, plateX, plateY, plateW, plateH, Math.round(fontSize * 0.3));
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  let cursor = plateY + pad;
  for (const row of laid) {
    const isTitle = row.kind === 'title';
    const size = isTitle ? titleSize : fontSize;
    const step = isTitle ? titleLineH : lineH;
    ctx.font = fontFor(row.kind);
    ctx.fillStyle = MARK;
    for (const line of row.lines) {
      cursor += step;
      ctx.fillText(line, plateX + pad, cursor - Math.round(size * 0.3));
    }
    if (isTitle) cursor += gapAfterTitle;
  }

  if (bar) {
    paintScaleBar(
      ctx,
      bar,
      plateX + pad,
      cursor + barGap,
      barH,
      Math.round(fontSize * 0.9),
    );
  }
  ctx.restore();
};

// ---------------------------------------------------------------------------
// North arrow
// ---------------------------------------------------------------------------

export type NorthArrowOptions = {
  cx: number;
  cy: number;
  radius: number;
  /**
   * OpenLayers view rotation in radians, positive clockwise. Every stitched
   * raster is north-up in EPSG:25833 and gets no arrow at all; only a
   * screenshot of a rotated map does. The content is drawn rotated by the
   * *negative* of it, so that is how far the arrow turns to keep pointing at
   * grid north.
   */
  rotation: number;
};

export const drawNorthArrow = (
  ctx: CanvasRenderingContext2D,
  { cx, cy, radius, rotation }: NorthArrowOptions,
): void => {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = PLATE;
  ctx.fill();

  ctx.translate(cx, cy);
  ctx.rotate(-rotation);

  ctx.fillStyle = MARK;
  ctx.font = font(Math.round(radius * 0.6), 700);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', 0, -radius * 0.58);

  // A kite, not a triangle: the waist is what tells you which end is the point
  // when the whole thing is 30 px across.
  const tip = -radius * 0.2;
  const base = radius * 0.74;
  const half = radius * 0.34;
  const waist = radius * 0.38;

  ctx.beginPath();
  ctx.moveTo(0, tip);
  ctx.lineTo(-half, base);
  ctx.lineTo(0, waist);
  ctx.closePath();
  ctx.fillStyle = MARK;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, tip);
  ctx.lineTo(half, base);
  ctx.lineTo(0, waist);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, tip);
  ctx.lineTo(-half, base);
  ctx.lineTo(0, waist);
  ctx.lineTo(half, base);
  ctx.closePath();
  ctx.strokeStyle = MARK;
  ctx.lineWidth = Math.max(1, radius * 0.05);
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.restore();
};
