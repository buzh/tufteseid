// Encoded size spreads some 250× across content, so the pixel budget is the
// rule and the byte budget a backstop that is measured rather than predicted.
// The byte cap is `evidence.file`'s: PocketBase answers 400 over it, and every
// retry of the same blob fails the same way.
const MAX_STORED_PIXELS = 40000000;
const MAX_STORED_BYTES = 50000000;

// The geometric step converges in one pass from any plausible start; the cap is
// so a pathological encoder cannot spin the queue.
const MAX_FIT_PASSES = 3;

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

export const canvasBlob = (
  canvas: HTMLCanvasElement,
  type: 'image/png' | 'image/jpeg',
  quality?: number,
): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Bare pixels fitted to the store, edge to edge over the rectangle they were
 * rendered for. The returned `metresPerPx` is the one achieved, which is not
 * the one passed in when the fit had to downscale.
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
    if (blob.size <= MAX_STORED_BYTES) {
      // Ratio of widths rather than the factor applied, so the rounding
      // `scaleCanvas` did is included instead of being asserted away.
      return { blob, metresPerPx: (metresPerPx * image.width) / source.width };
    }
    // Fails closed: an oversized blob is a 400 from PocketBase on every retry,
    // where null records the row as empty and stops asking.
    if (pass === MAX_FIT_PASSES) return null;
    // Bytes do not fall as fast as pixels, so the step takes a margin.
    source = scaleCanvas(
      source,
      Math.sqrt(MAX_STORED_BYTES / blob.size) * 0.95,
    );
  }
};
