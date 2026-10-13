

import { useCallback, useState } from 'react';

import { evidenceFileUrl, type EvidenceRecord } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { sanitizeFilename } from '../shared/utils/filename';
import { canvasBlob } from './fit';
import { evidenceTitle } from './labels';
import { withLegend } from './legend';
import { centreOf, legendContentFor } from './legendContent';
import { evidenceBbox, evidenceResolution, specOf } from './spec';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'video/webm': 'webm',
};

export const extensionOf = (type: string): string => EXTENSIONS[type] ?? 'png';

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

const stampEvidence = async (
  blob: Blob,
  rec: EvidenceRecord,
  spot: SpotRecord,
): Promise<Blob> => {
  if (blob.type.startsWith('video/')) return blob;

  try {
    const canvas = await decodeToCanvas(blob);
    if (!canvas) return blob;

    const bbox = evidenceBbox(rec);
    const content = legendContentFor(rec, spot, bbox ? centreOf(bbox) : '');
    if (!content) return blob;

    const stamped = await withLegend(canvas, {
      ...content,

      metresPerPx: bbox
        ? (bbox[2] - bbox[0]) / canvas.width
        : (evidenceResolution(rec) ?? 0),
    });

    const jpeg = blob.type === 'image/jpeg';
    const out = await canvasBlob(
      stamped,
      jpeg ? 'image/jpeg' : 'image/png',
      jpeg ? 0.9 : undefined,
    );
    return out ?? blob;
  } catch (e) {
    console.warn('[evidence] stamp failed', e);
    return blob;
  }
};

export const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

type EvidenceDownload = {
  download: (rec: EvidenceRecord) => void;

  busyId: string | null;

  failedId: string | null;
};

export const useEvidenceDownload = (spot: SpotRecord): EvidenceDownload => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  const download = useCallback(
    (rec: EvidenceRecord) => {
      const url = evidenceFileUrl(rec);

      if (!url || busyId) return;
      setBusyId(rec.id);
      setFailedId(null);
      void (async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`file ${res.status}`);
          const stamped = await stampEvidence(await res.blob(), rec, spot);
          const spec = specOf(rec);
          const name = sanitizeFilename(
            [spot.name, spec && evidenceTitle(spec)].filter(Boolean).join(' '),
          );
          saveBlob(stamped, `${name}.${extensionOf(stamped.type)}`);
        } catch (e) {
          console.warn('[evidence] download failed', e);
          setFailedId(rec.id);
        } finally {
          setBusyId(null);
        }
      })();
    },
    [spot, busyId],
  );

  return { download, busyId, failedId };
};
