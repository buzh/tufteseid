// The drawing half of the provenance legend: a band along the bottom edge of an
// image carrying what it is a picture of, at what scale, and who owns it. Every
// dimension derives from the one font size the caller computes from the image
// width, so a 500 px LiDAR extract and a 2500 px ortofoto come out as the same
// legend. White on a translucent dark band, because it sits on ground that is
// black under a VAT and white under a slope map.
//
// Nothing here goes into a stored file. The legend is stamped on the way out —
// see `stamp.ts`.

import i18n from 'i18next';

const FAMILY = "Mulish, system-ui, -apple-system, 'Segoe UI', sans-serif";

const BAND = 'rgba(10, 12, 14, 0.62)';
const MARK = '#ffffff';
const MARK_DARK = '#14171a';

const locale = () => i18n.language || 'nb';

const int = (value: number): string =>
  new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(value);

const dec = (value: number, digits: number): string =>
  new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(
    value,
  );

/**
 * Linear in the image width between the clamps. A footprint is 50–500 m and the
 * producers publish between 1 and 0.2 m/px, so a render is anywhere from 50 to
 * 2500 px across; this keeps the legend a roughly constant fraction of it.
 */
export const legendFontSize = (width: number): number =>
  Math.round(Math.min(26, Math.max(11, width / 70)));

/**
 * Canvas text does not wait for webfonts — it silently falls through to the
 * next family in the stack, which would make two figures stamped a second apart
 * look different. Covers the cold case only.
 */
export const ensureLegendFont = async (size: number): Promise<void> => {
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

// Under this the four segments are indistinguishable and the bar is left off.
const MIN_BAR_PX = 24;

// Of the image, not of the legend: the bar is a statement about the ground, and
// one that changed with how long the rights line was would be a strange thing
// to measure with. It shares its line with a rights line, so it takes less of
// the width than a bar on a plate of its own could.
const BAR_TARGET_FRACTION = 0.18;

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
  return { barPx, label: scaleLabel(metres) };
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
  const seg = bar.barPx / 4;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? MARK : MARK_DARK;
    ctx.fillRect(x + i * seg, y, seg + 0.5, barH);
  }
  ctx.strokeStyle = MARK;
  ctx.lineWidth = Math.max(1, Math.round(labelSize * 0.07));
  ctx.strokeRect(x, y, bar.barPx, barH);

  ctx.textAlign = 'left';
  ctx.fillStyle = MARK;
  ctx.font = font(labelSize, 600);
  ctx.fillText(bar.label, x + bar.barPx + Math.round(labelSize * 0.6), mid);
};

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

export type LegendOptions = {
  width: number;
  height: number;
  /** Line one, weight 600: what the picture is. */
  title: string;
  /** The rest of line one, joined with the separator. Shed from the end when
   *  the line will not fit, so the list must be ordered with the fact that can
   *  best be spared last. */
  facts: string[];
  /** The right column, one line each, and the one thing here that is never
   *  shed: it is the only part of the legend the licences actually require. */
  rights: string[];
  /** The left column under the scale bar. Empty where there is nothing to point
   *  at. */
  link: string;
  /** Of the image as it will be written, so the bar measures true. */
  metresPerPx: number;
  fontSize: number;
};

type TextCell = { kind: 'text'; text: string; width: number };

type Cell = { kind: 'bar'; bar: ScaleBar; width: number } | TextCell;

// The right column is rights lines and nothing else, so it never holds a bar.
type Row = { left?: Cell; right?: TextCell };

const SEP = ' · ';

// Between the two columns. Below this they read as one run of text.
const GAP_EM = 1.5;

// A legend taller than this is not a caption on a picture, it is a picture with
// a caption attached. A thumbnail gets nothing instead, which is the right
// answer: national LiDAR over the smallest footprint is 50 px square.
const MAX_HEIGHT_FRACTION = 0.2;

/**
 * Paint the legend along the image's bottom edge. Never throws, never resizes
 * and never touches a pixel above the band, so a stamped file is still
 * pixel-registered to its bbox everywhere the legend is not.
 */
export const drawLegend = (
  ctx: CanvasRenderingContext2D,
  {
    width,
    height,
    title,
    facts,
    rights,
    link,
    metresPerPx,
    fontSize,
  }: LegendOptions,
): void => {
  const pad = Math.round(fontSize * 0.7);
  const lineH = Math.round(fontSize * 1.35);
  const gap = Math.round(fontSize * GAP_EM);
  const barH = Math.max(4, Math.round(fontSize * 0.38));
  const labelSize = Math.round(fontSize * 0.9);

  const contentW = width - pad * 2;
  if (contentW < fontSize * 8) return;

  const headFont = font(fontSize, 600);
  const bodyFont = font(fontSize);

  ctx.save();

  ctx.font = headFont;
  const titleW = ctx.measureText(title).width;
  ctx.font = bodyFont;
  const kept = [...facts];
  while (
    kept.length > 0 &&
    titleW + ctx.measureText(SEP + kept.join(SEP)).width > contentW
  ) {
    kept.pop();
  }
  const tail = kept.length > 0 ? SEP + kept.join(SEP) : '';

  const bar = planScaleBar(
    metresPerPx,
    Math.min(width * BAR_TARGET_FRACTION, contentW / 2),
  );

  const left: Cell[] = [];
  if (bar) {
    ctx.font = font(labelSize, 600);
    left.push({
      kind: 'bar',
      bar,
      width:
        bar.barPx +
        Math.round(labelSize * 0.6) +
        ctx.measureText(bar.label).width,
    });
  }
  ctx.font = bodyFont;
  if (link) {
    left.push({ kind: 'text', text: link, width: ctx.measureText(link).width });
  }
  const right: TextCell[] = rights.filter(Boolean).map((text) => ({
    kind: 'text' as const,
    text,
    width: ctx.measureText(text).width,
  }));

  // Greedy: a left cell pairs with a right one where both fit, otherwise the
  // left goes alone and the right waits for the next line. A rights line too
  // wide for the image even on its own wraps rather than being cut.
  const rows: Row[] = [];
  let li = 0;
  let ri = 0;
  while (li < left.length || ri < right.length) {
    const l = left[li];
    const r = right[ri];
    if (l && r && l.width + gap + r.width <= contentW) {
      rows.push({ left: l, right: r });
      li++;
      ri++;
    } else if (l) {
      rows.push({ left: l });
      li++;
    } else if (r) {
      if (r.width <= contentW) rows.push({ right: r });
      else {
        for (const line of wrap(ctx, r.text, contentW)) {
          rows.push({ right: { kind: 'text', text: line, width: 0 } });
        }
      }
      ri++;
    } else break;
  }

  const legendH = pad * 2 + lineH * (1 + rows.length);
  if (legendH > height * MAX_HEIGHT_FRACTION) {
    ctx.restore();
    return;
  }

  ctx.fillStyle = BAND;
  ctx.fillRect(0, height - legendH, width, legendH);

  ctx.textBaseline = 'middle';
  ctx.fillStyle = MARK;
  let mid = height - legendH + pad + lineH / 2;

  ctx.textAlign = 'left';
  ctx.font = headFont;
  ctx.fillText(title, pad, mid);
  if (tail) {
    ctx.font = bodyFont;
    ctx.fillText(tail, pad + titleW, mid);
  }

  for (const row of rows) {
    mid += lineH;
    if (row.left?.kind === 'bar') {
      paintScaleBar(ctx, row.left.bar, pad, mid, barH, labelSize);
    } else if (row.left) {
      ctx.textAlign = 'left';
      ctx.fillStyle = MARK;
      ctx.font = bodyFont;
      ctx.fillText(row.left.text, pad, mid);
    }
    if (row.right) {
      ctx.textAlign = 'right';
      ctx.fillStyle = MARK;
      ctx.font = bodyFont;
      ctx.fillText(row.right.text, width - pad, mid);
    }
  }

  ctx.restore();
};
