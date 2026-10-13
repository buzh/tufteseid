import type { Metric } from '../map/bbox';

export const MAX_STORED_PIXELS = 40000000;
const MAX_STORED_BYTES = 50000000;

const MAX_FIT_PASSES = 3;

export type Raster = {
  canvas: HTMLCanvasElement;
  metresPerPx: number;
  bbox25833: Metric;
};

const scaleCanvas = (
  src: HTMLCanvasElement,
  factor: number,
): HTMLCanvasElement => {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(src.width * factor));
  out.height = Math.max(1, Math.round(src.height * factor));
  const ctx = out.getContext('2d');

  if (!ctx) return src;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
};

export const canvasBlob = (
  canvas: HTMLCanvasElement,
  type: 'image/png' | 'image/jpeg',
  quality?: number,
): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

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
    if (blob.size <= MAX_STORED_BYTES) {

      return { blob, metresPerPx: (metresPerPx * image.width) / source.width };
    }

    if (pass === MAX_FIT_PASSES) return null;

    source = scaleCanvas(
      source,
      Math.sqrt(MAX_STORED_BYTES / blob.size) * 0.95,
    );
  }
};
