import i18n from 'i18next';

const FAMILY = "Mulish, system-ui, -apple-system, 'Segoe UI', sans-serif";

// The band sits on ground that is black under a VAT and white under a slope map.
const BAND = 'rgba(10, 12, 14, 0.62)';
const MARK = '#ffffff';
const MARK_DARK = '#14171a';

const locale = () => i18n.language || 'nb';

const int = (value: number): string =>
  new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(value);

/**
 * Linear in the image width between the clamps. A footprint is 50–500 m and the
 * producers publish between 1 and 0.08 m/px, so a render is anywhere from 50 to
 * 6300 px across; this keeps the legend a roughly constant fraction of it.
 */
const fontSizeFor = (width: number): number =>
  Math.round(Math.min(26, Math.max(11, width / 70)));

/**
 * Canvas text does not wait for webfonts — it silently falls through to the
 * next family in the stack, which would make two figures stamped a second apart
 * look different. Covers the cold case only.
 */
const ensureFont = async (size: number): Promise<void> => {
  const fonts = document.fonts;
  if (!fonts?.load) return;
  try {
    await Promise.all([
      fonts.load(`${size}px Mulish`),
      fonts.load(`600 ${size}px Mulish`),
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

/** Cut to fit under the font currently set on `ctx`. */
const ellipsize = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string => {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
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

// Under this the four segments are indistinguishable and the bar is left off.
const MIN_BAR_PX = 24;

// Of the image, not of the legend: a bar whose length depended on how long the
// rights line was would be a strange thing to measure ground with.
const BAR_TARGET_FRACTION = 0.18;

// Between the bar and its label, in ems of the label's own size.
const BAR_LABEL_GAP_EM = 0.6;

type ScaleBar = { barPx: number; label: string };

const planScaleBar = (
  metresPerPx: number,
  targetPx: number,
): ScaleBar | null => {
  if (!Number.isFinite(metresPerPx) || metresPerPx <= 0) return null;
  if (!Number.isFinite(targetPx) || targetPx <= 0) return null;
  const metres = niceMetres(targetPx * metresPerPx);
  const barPx = metres / metresPerPx;
  if (!Number.isFinite(barPx) || barPx < MIN_BAR_PX) return null;
  // A footprint is capped at `MAX_SIDE_M`, and the bar spans a fraction of it,
  // so the label never reaches a kilometre.
  return { barPx, label: `${int(metres)} m` };
};

/** Four alternating segments with the ground distance beside them, centred on
 *  its line rather than sitting on a baseline. */
const paintScaleBar = (
  ctx: CanvasRenderingContext2D,
  bar: ScaleBar,
  x: number,
  mid: number,
  barH: number,
  labelSize: number,
) => {
  const y = Math.round(mid - barH / 2);
  for (let i = 0; i < 4; i++) {
    // Rounded boundaries rather than a rounded width, so the segments meet with
    // no seam and the last one ends on the stroked edge.
    const from = Math.round(x + (i * bar.barPx) / 4);
    const to = Math.round(x + ((i + 1) * bar.barPx) / 4);
    ctx.fillStyle = i % 2 === 0 ? MARK : MARK_DARK;
    ctx.fillRect(from, y, to - from, barH);
  }
  ctx.strokeStyle = MARK;
  ctx.lineWidth = Math.max(1, Math.round(labelSize * 0.07));
  ctx.strokeRect(x, y, bar.barPx, barH);

  ctx.textAlign = 'left';
  ctx.fillStyle = MARK;
  ctx.font = font(labelSize, 600);
  ctx.fillText(
    bar.label,
    x + bar.barPx + Math.round(labelSize * BAR_LABEL_GAP_EM),
    mid,
  );
};

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

type LegendOptions = {
  width: number;
  height: number;
  /** Line one, weight 600: what the picture is. */
  title: string;
  /** The rest of line one, joined with the separator. Shed from the end when
   *  the line will not fit, so the list must be ordered with the fact that can
   *  best be spared last. */
  facts: string[];
  /** Under line one, flush left, one per line and never shed: the only part of
   *  the legend the licences actually require. */
  rights: string[];
  /** The footer row's right end. Empty where there is nothing to point at. */
  link: string;
  /** Of the image as it will be written, so the bar measures true. */
  metresPerPx: number;
};

const SEP = ' · ';

// Least space between the scale bar and the link that still reads as two things
// rather than one run of text.
const GAP_EM = 1.5;

// The footer row is shed whole to keep the band under this fraction of the
// image: the bar and the link share a line, so dropping one of them buys no
// height. The rights lines are never shed.
const SHED_HEIGHT_FRACTION = 0.2;

// Past this nothing is drawn at all. Narrow images are turned away by the
// `contentW` floor before they reach here.
const MAX_HEIGHT_FRACTION = 0.5;

/**
 * Paint the legend along the image's bottom edge. Never throws, never resizes
 * and never touches a pixel above the band, so a stamped file is still
 * pixel-registered to its bbox everywhere the legend is not.
 *
 * False when the image is too small to carry one, which is the caller's cue to
 * ship the bytes it already has rather than re-encode them unchanged.
 */
export const drawLegend = async (
  ctx: CanvasRenderingContext2D,
  { width, height, title, facts, rights, link, metresPerPx }: LegendOptions,
): Promise<boolean> => {
  const fontSize = fontSizeFor(width);
  await ensureFont(fontSize);

  const pad = Math.round(fontSize * 0.7);
  const lineH = Math.round(fontSize * 1.35);
  const gap = Math.round(fontSize * GAP_EM);
  const barH = Math.max(4, Math.round(fontSize * 0.38));
  const labelSize = Math.round(fontSize * 0.9);

  const contentW = width - pad * 2;
  if (contentW < fontSize * 8) return false;

  const headFont = font(fontSize, 600);
  const bodyFont = font(fontSize);

  ctx.save();

  ctx.font = headFont;
  const head = ellipsize(ctx, title, contentW);
  const titleW = ctx.measureText(head).width;
  ctx.font = bodyFont;
  const kept = [...facts];
  while (
    kept.length > 0 &&
    titleW + ctx.measureText(SEP + kept.join(SEP)).width > contentW
  ) {
    kept.pop();
  }
  const tail = kept.length > 0 ? SEP + kept.join(SEP) : '';

  // A rights line too wide for the image wraps rather than being cut.
  const body = rights
    .filter(Boolean)
    .flatMap((line) => wrap(ctx, line, contentW));

  const bar = planScaleBar(
    metresPerPx,
    Math.min(width * BAR_TARGET_FRACTION, contentW / 2),
  );
  ctx.font = font(labelSize, 600);
  const barW = bar
    ? bar.barPx +
      Math.round(labelSize * BAR_LABEL_GAP_EM) +
      ctx.measureText(bar.label).width
    : 0;

  const bandHeight = (withFooter: boolean) =>
    pad * 2 + lineH * (1 + body.length + (withFooter ? 1 : 0));

  let footer = Boolean(bar) || Boolean(link);
  if (footer && bandHeight(true) > height * SHED_HEIGHT_FRACTION) {
    footer = false;
  }

  const legendH = bandHeight(footer);
  if (legendH > height * MAX_HEIGHT_FRACTION) {
    ctx.restore();
    return false;
  }

  ctx.fillStyle = BAND;
  ctx.fillRect(0, height - legendH, width, legendH);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = MARK;
  let mid = Math.round(height - legendH + pad + lineH / 2);

  ctx.font = headFont;
  ctx.fillText(head, pad, mid);
  if (tail) {
    ctx.font = bodyFont;
    ctx.fillText(tail, Math.round(pad + titleW), mid);
  }

  ctx.font = bodyFont;
  for (const line of body) {
    mid += lineH;
    ctx.fillText(line, pad, mid);
  }

  if (footer) {
    mid += lineH;
    if (bar) paintScaleBar(ctx, bar, pad, mid, barH, labelSize);
    // What the bar leaves, less the gap that keeps the two apart. The link is
    // cut rather than allowed to run into the bar: the bar is the one a reader
    // measures ground with.
    const room = contentW - (bar ? barW + gap : 0);
    if (link && room > 0) {
      ctx.textAlign = 'right';
      ctx.fillStyle = MARK;
      ctx.font = bodyFont;
      ctx.fillText(ellipsize(ctx, link, room), width - pad, mid);
    }
  }

  ctx.restore();
  return true;
};
