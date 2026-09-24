import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { evidenceFileUrl, type EvidenceRecord } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { sanitizeFilename } from './filename';
import { evidenceTitle } from './labels';
import { specOf } from './spec';
import { stampEvidence } from './stamp';

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
  /** The row whose last attempt failed. Sticky until the next one: a download
   *  that never arrives looks the same as one that was never asked for. */
  failedId: string | null;
};

export const useEvidenceDownload = (spot: SpotRecord): EvidenceDownload => {
  const { i18n } = useTranslation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  const download = useCallback(
    (rec: EvidenceRecord) => {
      const url = evidenceFileUrl(rec);
      // One at a time: decoding, stamping and re-encoding a 2500 px raster is
      // about a second of main-thread work, and two at once only slows both.
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
          const ext = stamped.type === 'image/jpeg' ? 'jpg' : 'png';
          save(stamped, `${name}.${ext}`);
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
