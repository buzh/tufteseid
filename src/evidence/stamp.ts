// The stored file is bare: the reader lays it back on the ground it was made
// over and the sketch draws on top of it, so a band burned into the pixels
// would ride the map and be drawn over. The provenance goes on at the door
// instead, which is why it comes out in the reader's current language.
//
// A sun loop is the exception and is cited by the sidecar at render time: this
// module decodes with `createImageBitmap`, which throws on a WebM.

import type { EvidenceRecord } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { canvasBlob } from './fit';
import { evidenceResolution } from './labels';
import { centreOf, legendContentFor } from './legendContent';
import { drawLegend } from './legend';
import { evidenceBbox } from './spec';

const decodeToCanvas = async (
  blob: Blob,
): Promise<HTMLCanvasElement | null> => {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
};

/**
 * The stored raster with its provenance on it. Failure is never fatal: an
 * unstamped file is worse than a stamped one and far better than none, so every
 * path that cannot produce a legend returns the bytes it was given. A video is
 * one of those paths — it already carries its band.
 *
 * Re-encodes in the type it was handed, so a JPEG ortofoto does not come back a
 * PNG four times the size.
 */
export const stampEvidence = async (
  blob: Blob,
  rec: EvidenceRecord,
  spot: SpotRecord,
  language: string,
): Promise<Blob> => {
  if (blob.type.startsWith('video/')) return blob;

  try {
    const canvas = await decodeToCanvas(blob);
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return blob;

    const bbox = evidenceBbox(rec);
    const content = legendContentFor(
      rec,
      spot,
      language,
      bbox ? centreOf(bbox) : '',
    );
    if (!content) return blob;

    const drawn = await drawLegend(ctx, {
      width: canvas.width,
      height: canvas.height,
      ...content,
      // Off the decoded width rather than `meta.metresPerPx`, so the bar
      // measures the pixels in hand even where the stored figure disagrees
      // with them.
      metresPerPx: bbox
        ? (bbox[2] - bbox[0]) / canvas.width
        : (evidenceResolution(rec) ?? 0),
    });
    // Nothing was painted, so re-encoding would only cost a JPEG generation.
    if (!drawn) return blob;

    const jpeg = blob.type === 'image/jpeg';
    const out = await canvasBlob(
      canvas,
      jpeg ? 'image/jpeg' : 'image/png',
      jpeg ? 0.9 : undefined,
    );
    return out ?? blob;
  } catch (e) {
    console.warn('[evidence] stamp failed', e);
    return blob;
  }
};
