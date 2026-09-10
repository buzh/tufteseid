/*
 * The drawing half of the provenance figure: the two map furnishings that go
 * *on* the image (scale bar, north arrow) and the caption block that goes
 * under it.
 *
 * Plain 2D canvas throughout, with every dimension derived from one
 * `fontSize` the caller computes from the image width — so a 600 px
 * screenshot and a 4000 px LiDAR extract come out looking like the same
 * figure rather than one with unreadable text and one with a caption you
 * could read across a room.
 *
 * The caption is *paper*: dark text on near-white, because these end up in
 * reports and next to excavation photographs, not in the app's chrome. The
 * furnishings are the opposite — white, cased on a translucent dark plate,
 * because they sit on ground that is black in one visualization and white in
 * the next.
 */

import i18n from 'i18next';

const FAMILY = "'Mulish', system-ui, -apple-system, 'Segoe UI', sans-serif";

// Caption.
const PAPER = '#f6f6f4';
const INK = '#16181a';
const INK_DIM = '#5f646a';
const RULE = '#c9ccd0';
// Behind an image narrower than the caption needs (see MIN_FIGURE_WIDTH).
export const MATTE = '#2a2d31';

// Furnishings.
const PLATE = 'rgba(10, 12, 14, 0.55)';
const MARK = '#ffffff';
const MARK_DARK = '#14171a';

const locale = () => i18n.language || 'nb';

export const int = (value: number): string =>
  new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(value);

/** Drop the empties and join with the caption's separator. */
export const joinDot = (parts: (string | null | undefined | false)[]): string =>
  parts.filter(Boolean).join(' · ');

export const dec = (value: number, digits: number): string =>
  new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(
    value,
  );

/**
 * Big enough to read, small enough not to shout. Linear in the image width
 * between the two clamps, which is what keeps the caption a roughly constant
 * fraction of the figure across three orders of magnitude of raster size.
 */
export const figureFontSize = (width: number): number =>
  Math.round(Math.min(34, Math.max(13, width / 55)));

/**
 * Canvas text does not wait for webfonts — it silently falls through to the
 * next family in the stack, which would make two figures saved a second apart
 * look different. Mulish is self-hosted and normally loaded long before
 * anyone saves anything; this only covers the cold case.
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
    // A figure in the fallback face beats no figure.
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
// Caption
// ---------------------------------------------------------------------------

/** A labelled line. The one row with no label is the title. */
export type CaptionRow = { label?: string; text: string };

type LaidOutRow = {
  label: string;
  /** Where the text column starts, so wrapped lines hang under the first. */
  indent: number;
  lines: string[];
  isTitle: boolean;
};

export type CaptionLayout = {
  height: number;
  /** Paint the block with its top edge at `top`. */
  draw: (ctx: CanvasRenderingContext2D, top: number) => void;
};

/**
 * Measure first, paint later. The caption's height depends on how the text
 * wraps, and the output canvas has to be sized before anything can be drawn
 * on it — so this lays out against a throwaway context and hands back both
 * the height and a closure that repeats the same walk for real.
 */
export const layoutCaption = (
  measure: CanvasRenderingContext2D,
  rows: CaptionRow[],
  width: number,
  fontSize: number,
): CaptionLayout => {
  const pad = Math.round(fontSize * 0.95);
  const lineH = Math.round(fontSize * 1.32);
  const titleSize = Math.round(fontSize * 1.22);
  const titleLineH = Math.round(titleSize * 1.25);
  const gapAfterTitle = Math.round(fontSize * 0.5);
  const labelGap = Math.round(fontSize * 0.7);
  const maxWidth = width - pad * 2;

  const laidOut: LaidOutRow[] = [];
  for (const row of rows) {
    if (!row.text) continue;
    const isTitle = !row.label;
    if (isTitle) {
      measure.font = font(titleSize, 700);
      laidOut.push({
        label: '',
        indent: 0,
        lines: wrap(measure, row.text, maxWidth),
        isTitle,
      });
      continue;
    }
    measure.font = font(fontSize, 600);
    const indent = Math.round(
      measure.measureText(row.label ?? '').width + labelGap,
    );
    measure.font = font(fontSize);
    laidOut.push({
      label: row.label ?? '',
      indent,
      lines: wrap(measure, row.text, Math.max(40, maxWidth - indent)),
      isTitle,
    });
  }

  let height = pad * 2;
  for (const row of laidOut) {
    height += row.isTitle
      ? row.lines.length * titleLineH + gapAfterTitle
      : row.lines.length * lineH;
  }

  const draw = (ctx: CanvasRenderingContext2D, top: number) => {
    ctx.save();
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, top, width, height);
    ctx.fillStyle = RULE;
    ctx.fillRect(0, top, width, 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    let y = top + pad;
    for (const row of laidOut) {
      if (row.isTitle) {
        ctx.font = font(titleSize, 700);
        ctx.fillStyle = INK;
        for (const line of row.lines) {
          y += titleLineH;
          ctx.fillText(line, pad, y - Math.round(titleSize * 0.3));
        }
        y += gapAfterTitle;
        continue;
      }
      row.lines.forEach((line, i) => {
        y += lineH;
        const baseline = y - Math.round(fontSize * 0.32);
        if (i === 0) {
          ctx.font = font(fontSize, 600);
          ctx.fillStyle = INK_DIM;
          ctx.fillText(row.label, pad, baseline);
        }
        ctx.font = font(fontSize);
        ctx.fillStyle = INK;
        ctx.fillText(line, pad + row.indent, baseline);
      });
    }
    ctx.restore();
  };

  return { height, draw };
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

export type ScaleBarOptions = {
  /** Left edge of the image area. */
  x: number;
  /** Bottom edge the bar sits above. */
  bottom: number;
  /** Image width, which the bar targets a fixed fraction of. */
  width: number;
  metresPerPx: number;
  fontSize: number;
};

/**
 * Four alternating segments with the ground distance above them.
 *
 * `niceMetres` rounds *down*, so the bar is always at or under the 22 %
 * target and can never run off the plate — the only case worth guarding is
 * the other end, where a thumbnail-sized image would get a bar too short to
 * measure anything against.
 */
export const drawScaleBar = (
  ctx: CanvasRenderingContext2D,
  { x, bottom, width, metresPerPx, fontSize }: ScaleBarOptions,
): void => {
  if (!Number.isFinite(metresPerPx) || metresPerPx <= 0) return;
  const metres = niceMetres(width * 0.22 * metresPerPx);
  const barPx = metres / metresPerPx;
  if (!Number.isFinite(barPx) || barPx < 24) return;

  const label = scaleLabel(metres);
  const barH = Math.max(5, Math.round(fontSize * 0.42));
  const labelSize = Math.round(fontSize * 0.9);
  const pad = Math.round(fontSize * 0.5);
  const gap = Math.round(fontSize * 0.28);

  ctx.save();
  ctx.font = font(labelSize, 700);
  const plateW = Math.max(barPx, ctx.measureText(label).width) + pad * 2;
  const plateH = labelSize + gap + barH + pad * 2;
  const plateX = x;
  const plateY = bottom - plateH;
  ctx.fillStyle = PLATE;
  roundRect(ctx, plateX, plateY, plateW, plateH, Math.round(fontSize * 0.3));
  ctx.fill();

  const barX = plateX + (plateW - barPx) / 2;
  const barY = plateY + pad + labelSize + gap;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = MARK;
  ctx.fillText(label, plateX + plateW / 2, barY - gap);

  const seg = barPx / 4;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? MARK : MARK_DARK;
    ctx.fillRect(barX + i * seg, barY, seg + 0.5, barH);
  }
  ctx.strokeStyle = MARK;
  ctx.lineWidth = Math.max(1, Math.round(fontSize * 0.07));
  ctx.strokeRect(barX, barY, barPx, barH);
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
   * OpenLayers view rotation in radians, positive clockwise. Zero for every
   * stitched raster — they are requested north-up in EPSG:25833 — and
   * non-zero only for a screenshot of a rotated map. The content is drawn
   * rotated by the *negative* of it, so that is how far the arrow has to
   * turn to keep pointing at grid north.
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

  // A kite, not a triangle: the waist is what tells you which end is the
  // point when the whole thing is 30 px across.
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
