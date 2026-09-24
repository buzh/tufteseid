// A download is the only door a picture leaves the app by, so it is also the
// only place the provenance strip goes on. One at a time: a 2500 px raster
// decoded, stamped and re-encoded is a second of main-thread work, and two of
// them at once would only make both slower.

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

export type EvidenceDownload = {
  download: (rec: EvidenceRecord) => void;
  /** The row being stamped, or null. */
  busyId: string | null;
  /** The row whose last attempt failed. Sticky until the next one: the button
   *  is the only thing that can say so, since a download that never arrives
   *  looks the same as one that was never asked for. */
  failedId: string | null;
};

export const useEvidenceDownload = (spot: SpotRecord): EvidenceDownload => {
  const { i18n } = useTranslation();
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
          const stamped = await stampEvidence(
            await res.blob(),
            rec,
            spot,
            i18n.language,
          );
          const spec = specOf(rec);
          const name = sanitizeFilename(
            `${spot.name} ${spec ? evidenceTitle(spec) : ''}`,
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
