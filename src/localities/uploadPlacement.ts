/*
 * Giving an upload a rectangle (docs/lokalitet-view.md §13.5, §13.10 step 7).
 *
 * Every other placeable raster in the app knows where it is because something
 * measured it: an extract and a terrain render are cut *to* the lokalitet's
 * rectangle, a flyfoto is fetched over it, a screenshot records the map extent
 * it was taken of. An upload is the one producer with no answer at all — it is
 * bytes somebody chose off their disk, and §4.1's table says so by making it
 * the single kind that bypasses the figure stage. That is correct for a field
 * photograph and wrong for a scanned old map or a georeferenced export out of
 * QGIS, which are exactly the things worth laying over the ground.
 *
 * So: **an opt-in, per upload**, and the whole mechanism is one key. Writing
 * `meta.bbox25833` makes the record eligible for [Bilde]; deleting it is the
 * undo. `cropOf` in `groundView.ts` already falls back to the whole image when
 * there is no `imageRect`, so nothing else has to learn about this at all.
 *
 * Two properties this module exists to hold, both from §13.5:
 *
 * - **The image's aspect, not the rectangle's.** Painting a 4:3 scan at a 1:2
 *   rectangle squashes it, and a squashed map is not approximate — it is
 *   wrong in a way that survives being zoomed into. So the stored extent is
 *   the largest rectangle *of the image's own aspect* centred on the
 *   lokalitet's and contained in it: approximate in position and scale, never
 *   wrong in shape. The day somebody builds a drag-the-corners georeferencer,
 *   it edits a value of the right kind rather than replacing one of the wrong
 *   kind.
 * - **It is an assumption and it says so.** `meta.bboxAssumed` rides along, and
 *   every surface that shows the placement shows the mark. An extent the app
 *   invented sitting in a pulldown beside an extract's measured one, unmarked,
 *   would be the app asserting something nobody told it.
 */

import { transformExtent } from 'ol/proj';
import { getAttachmentUrl, type AttachmentRecord } from '../api/attachments';
import type { LocalityBbox } from '../api/localities';

/** `[minX, minY, maxX, maxY]`, as every producer writes `meta.bbox25833`. */
export type Extent25833 = [number, number, number, number];

/**
 * The file's width ÷ height.
 *
 * Read off the 800 px thumbnail rather than the original: PocketBase keeps the
 * ratio when one dimension is 0, and the original can be fifty megabytes for a
 * number two integers wide. The rounding that costs is at most half a pixel in
 * 800 — a few centimetres across a lokalitet, on a rectangle whose *position*
 * is a guess to begin with.
 */
export const imageAspectOf = async (rec: AttachmentRecord): Promise<number> => {
  const url = await getAttachmentUrl(rec, '800x0');
  const img = new Image();
  img.src = url;
  await img.decode();
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!w || !h) throw new Error('image has no dimensions');
  return w / h;
};

/**
 * The largest rectangle of `aspect` centred in the lokalitet's own.
 *
 * Contained rather than covering: an image that overflowed the rectangle would
 * put pixels the author never placed outside the area they authored, and the
 * lokalitet's edge is the one line on this map that means something.
 */
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
  // Wider than the rectangle → the width is the binding side, and vice versa.
  const wide = width / height > aspect;
  const w = wide ? height * aspect : width;
  const h = wide ? height : width / aspect;
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
};

/** Whether a record's extent is one the app invented rather than measured. */
export const isBboxAssumed = (rec: AttachmentRecord): boolean =>
  rec.meta?.bboxAssumed === true;
