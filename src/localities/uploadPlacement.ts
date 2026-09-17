// Giving an upload a rectangle, opt-in per record. An upload is the one
// producer with no measured extent, so writing `meta.bbox25833` is what makes
// it eligible for [Bilde] and deleting the key is the undo; `meta.bboxAssumed`
// rides along so every surface can mark it as invented rather than measured.

import { transformExtent } from 'ol/proj';
import { getAttachmentUrl, type AttachmentRecord } from '../api/attachments';
import type { LocalityBbox } from '../api/localities';

/** As every producer writes `meta.bbox25833`. */
export type Extent25833 = [number, number, number, number];

/** Read off the 800 px thumbnail: PB keeps the ratio when one dimension is 0. */
export const imageAspectOf = async (rec: AttachmentRecord): Promise<number> => {
  const img = new Image();
  img.src = getAttachmentUrl(rec, '800x0');
  await img.decode();
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!w || !h) throw new Error('image has no dimensions');
  return w / h;
};

/** The largest rectangle of `aspect` contained in the lokalitet's own. The
 * image's aspect, not the rectangle's: a 4:3 scan at 1:2 stays squashed. */
export const assumedExtentOf = (
  bbox: LocalityBbox,
  aspect: number,
): Extent25833 => {
  const [minX, minY, maxX, maxY] = transformExtent(
    bbox,
    'EPSG:4326',
    'EPSG:25833',
  );
  const width = maxX - minX;
  const height = maxY - minY;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Wider than the rectangle → width is the binding side, and vice versa.
  const wide = width / height > aspect;
  const w = wide ? height * aspect : width;
  const h = wide ? height : width / aspect;
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
};

/** Whether a record's extent is one the app invented rather than measured. */
export const isBboxAssumed = (rec: AttachmentRecord): boolean =>
  rec.meta?.bboxAssumed === true;
