// A picture out of the door: the stored file with its provenance typeset onto
// it, saved under the spot's name.
//
// The stored file is bare. The reader lays it back on the ground it was made
// over and the sketch draws on top of it, so a band burned into the pixels
// would ride the map and be drawn over; the provenance goes on here instead,
// which is why it comes out in the reader's current language. A sun loop is the
// exception and is cited by the sidecar at render time: `createImageBitmap`
// throws on a WebM.

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { evidenceFileUrl, type EvidenceRecord } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { sanitizeFilename } from '../shared/utils/filename';
import { canvasBlob } from './fit';
import { evidenceTitle } from './labels';
import { drawLegend } from './legend';
import { centreOf, legendContentFor } from './legendContent';
import { evidenceBbox, evidenceResolution, specOf } from './spec';

// Off the blob rather than the row: the stamp re-encodes in the type it was
// handed, so the type in hand is the one the bytes are in.
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'video/webm': 'webm',
};

const extensionOf = (type: string): string => EXTENSIONS[type] ?? 'png';

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
 * The stored raster with its provenance on it. Failure is never fatal: every
 * path that cannot produce a legend returns the bytes it was given, a video
 * among them. Re-encodes in the type it was handed, so a JPEG ortofoto does not
 * come back a PNG four times the size.
 */
const stampEvidence = async (
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
      // measures the pixels in hand even where the stored figure disagrees.
      metresPerPx: bbox
        ? (bbox[2] - bbox[0]) / canvas.width
        : (evidenceResolution(rec) ?? 0),
    });
    // Nothing painted, so re-encoding would only cost a JPEG generation.
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

const save = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking in the same task cancels the download in Chromium: the click is
  // dispatched synchronously but the fetch of the object URL is not.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

type EvidenceDownload = {
  download: (rec: EvidenceRecord) => void;
  /** The row being stamped, or null. */
  busyId: string | null;
  /** The row whose last attempt failed, sticky until the next attempt. */
  failedId: string | null;
};

export const useEvidenceDownload = (spot: SpotRecord): EvidenceDownload => {
  const { i18n } = useTranslation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  const download = useCallback(
    (rec: EvidenceRecord) => {
      const url = evidenceFileUrl(rec);
      // One at a time: stamping a 2500 px raster is about a second of
      // main-thread work, and two at once only slows both.
      if (!url || busyId) return;
      setBusyId(rec.id);
      setFailedId(null);
      void (async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`file ${res.status}`);
          const stamped = await stampEvidence(
            await res.blob(),
            rec,
            spot,
            i18n.language,
          );
          const spec = specOf(rec);
          const name = sanitizeFilename(
            [spot.name, spec && evidenceTitle(spec)].filter(Boolean).join(' '),
          );
          save(stamped, `${name}.${extensionOf(stamped.type)}`);
        } catch (e) {
          console.warn('[evidence] download failed', e);
          setFailedId(rec.id);
        } finally {
          setBusyId(null);
        }
      })();
    },
    [spot, busyId, i18n.language],
  );

  return { download, busyId, failedId };
};
