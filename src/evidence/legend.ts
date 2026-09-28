import i18n from 'i18next';

const FAMILY = "Mulish, system-ui, -apple-system, 'Segoe UI', sans-serif";

// Both the band under the capture and the mat beside one too narrow to carry
// the footer row. Opaque: the band is appended rather than blended, so there is
// no ground under it left to show through.
const MAT = '#0a0c0e';
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

/** The next round distance up: 1 → 2 → 5 → 10. */
const nextNiceMetres = (metres: number): number => {
  const pow = 10 ** Math.floor(Math.log10(metres));
  const n = Math.round(metres / pow);
  return (n < 2 ? 2 : n < 5 ? 5 : 10) * pow;
};

// Under this the four segments are indistinguishable.
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
  let metres = niceMetres(targetPx * metresPerPx);
  // The bar is never shed, so a target too small for four legible segments
  // takes the next round distance up rather than leaving the figure unmeasured.
  // Over a small capture that makes a ruler wider than the picture, which is
  // honest — the mat beside it is not ground.
  while (metres / metresPerPx < MIN_BAR_PX) metres = nextNiceMetres(metres);
  const barPx = metres / metresPerPx;
  if (!Number.isFinite(barPx)) return null;
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
  /** Line one, weight 600: what the picture is. */
  title: string;
  /** The rest of line one, joined with the separator. Shed from the end when
   *  the line will not fit, so the list must be ordered with the fact that can
   *  best be spared last. */
  facts: string[];
  /** Under line one, flush left, one per line, wrapped rather than cut: the
   *  only part of the legend the licences actually require. */
  rights: string[];
  /** The footer row's middle. Empty where the row has no rectangle. */
  centre: string;
  /** The footer row's right end. Empty where there is nothing to point at. */
  link: string;
  /** Of the capture, so the bar measures true. */
  metresPerPx: number;
};

const SEP = ' · ';

// Least space between two cells of the footer row that still reads as two
// things rather than one run of text.
const GAP_EM = 1.5;

/**
 * The capture with its provenance under it, on a canvas of its own: the pixels
 * unchanged at the top, the band appended below, and a mat either side of a
 * capture too narrow to carry the footer row.
 *
 * Appended rather than blended over the bottom edge, so no pixel of the ground
 * is spent on caption. The cost is that the file is no longer registered to its
 * bbox — the download is a figure to cite, and the row the map lays back over
 * the ground is the stored one, which is never stamped.
 *
 * Returns the source canvas untouched only where there is no 2D context to
 * composite onto.
 */
export const withLegend = async (
  image: HTMLCanvasElement,
  { title, facts, rights, centre, link, metresPerPx }: LegendOptions,
): Promise<HTMLCanvasElement> => {
  // Off the capture rather than the canvas being composed: the mat widens the
  // canvas, and a font size that grew with it would want a wider band again.
  const fontSize = fontSizeFor(image.width);
  await ensureFont(fontSize);

  const pad = Math.round(fontSize * 0.7);
  const lineH = Math.round(fontSize * 1.35);
  const gap = Math.round(fontSize * GAP_EM);
  const barH = Math.max(4, Math.round(fontSize * 0.38));
  const labelSize = Math.round(fontSize * 0.9);

  const headFont = font(fontSize, 600);
  const bodyFont = font(fontSize);

  const out = document.createElement('canvas');
  const ctx = out.getContext('2d');
  if (!ctx) return image;

  // Measured before the canvas is sized, because what it measures is what the
  // width has to be. Setting `width` below resets every context property, so
  // nothing set here survives into the painting pass.
  const bar = planScaleBar(metresPerPx, image.width * BAR_TARGET_FRACTION);
  ctx.font = font(labelSize, 600);
  const barW = bar
    ? bar.barPx +
      Math.round(labelSize * BAR_LABEL_GAP_EM) +
      ctx.measureText(bar.label).width
    : 0;
  ctx.font = bodyFont;
  const centreW = centre ? ctx.measureText(centre).width : 0;
  const linkW = link ? ctx.measureText(link).width : 0;

  // The footer row sets the floor: it is never shed and never cut, so a capture
  // narrower than its three cells is matted out to them rather than the other
  // way round. The head is ellipsized and the rights wrap, so neither forces a
  // width of its own.
  const footerW =
    barW + centreW + linkW + (centreW ? gap : 0) + (linkW ? gap : 0);
  const width = Math.max(image.width, Math.ceil(footerW) + pad * 2);
  const contentW = width - pad * 2;

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

  const body = rights
    .filter(Boolean)
    .flatMap((line) => wrap(ctx, line, contentW));

  const bandH = pad * 2 + lineH * (2 + body.length);

  out.width = width;
  out.height = image.height + bandH;

  ctx.fillStyle = MAT;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(image, Math.round((width - image.width) / 2), 0);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = MARK;
  let mid = image.height + pad + Math.round(lineH / 2);

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

  mid += lineH;
  if (bar) paintScaleBar(ctx, bar, pad, mid, barH, labelSize);
  if (centre) {
    // Centred in what the bar and the link leave rather than on the canvas, so
    // the three cells cannot collide at the width the footer itself set.
    ctx.textAlign = 'center';
    ctx.fillStyle = MARK;
    ctx.font = bodyFont;
    const from = pad + (barW ? barW + gap : 0);
    const to = width - pad - (linkW ? linkW + gap : 0);
    ctx.fillText(centre, Math.round((from + to) / 2), mid);
  }
  if (link) {
    ctx.textAlign = 'right';
    ctx.fillStyle = MARK;
    ctx.font = bodyFont;
    ctx.fillText(link, width - pad, mid);
  }

  return out;
};
