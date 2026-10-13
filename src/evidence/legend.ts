import i18n from 'i18next';

const FAMILY = "Mulish, system-ui, -apple-system, 'Segoe UI', sans-serif";

const MAT = '#0a0c0e';
const MARK = '#ffffff';
const MARK_DARK = '#14171a';

const locale = () => i18n.language || 'nb';

const int = (value: number): string =>
  new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(value);

const fontSizeFor = (width: number): number =>
  Math.round(Math.min(26, Math.max(11, width / 70)));

const ensureFont = async (size: number): Promise<void> => {
  const fonts = document.fonts;
  if (!fonts?.load) return;
  try {
    await Promise.all([
      fonts.load(`${size}px Mulish`),
      fonts.load(`600 ${size}px Mulish`),
    ]);
  } catch {}
};

const font = (size: number, weight = 400) => `${weight} ${size}px ${FAMILY}`;

const wrap = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] => {
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

const niceMetres = (raw: number): number => {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow;
};

const nextNiceMetres = (metres: number): number => {
  const pow = 10 ** Math.floor(Math.log10(metres));
  const n = Math.round(metres / pow);
  return (n < 2 ? 2 : n < 5 ? 5 : 10) * pow;
};

const MIN_BAR_PX = 24;

const BAR_TARGET_FRACTION = 0.18;

const BAR_LABEL_GAP_EM = 0.6;

type ScaleBar = { barPx: number; label: string };

const planScaleBar = (
  metresPerPx: number,
  targetPx: number,
): ScaleBar | null => {
  if (!Number.isFinite(metresPerPx) || metresPerPx <= 0) return null;
  if (!Number.isFinite(targetPx) || targetPx <= 0) return null;
  let metres = niceMetres(targetPx * metresPerPx);
  while (metres / metresPerPx < MIN_BAR_PX) metres = nextNiceMetres(metres);
  const barPx = metres / metresPerPx;
  if (!Number.isFinite(barPx)) return null;
  return { barPx, label: `${int(metres)} m` };
};

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

type LegendOptions = {
  title: string;
  facts: string[];
  rights: string[];
  centre: string;
  link: string;
  metresPerPx: number;
};

const SEP = ' · ';

const GAP_EM = 1.5;

export const withLegend = async (
  image: HTMLCanvasElement,
  { title, facts, rights, centre, link, metresPerPx }: LegendOptions,
): Promise<HTMLCanvasElement> => {
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
