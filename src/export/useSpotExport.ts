import { useCallback, useState } from 'react';

import type { EvidenceRecord } from '../api/evidence';
import type { SpotRecord } from '../api/spots';
import { saveBlob } from '../evidence/download';
import { buildSpotBundle } from './spotBundle';

export type SpotExport = {
  run: () => void;
  busy: boolean;
  /** The last attempt failed, sticky until the next one. */
  failed: boolean;
};

/** One at a time: a bundle is every picture of the spot fetched, decoded and
 *  checksummed, and two at once only slow both. */
export const useSpotExport = (
  spot: SpotRecord,
  rows: readonly EvidenceRecord[] | null,
): SpotExport => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    void (async () => {
      try {
        const bundle = await buildSpotBundle(spot, rows ?? []);
        saveBlob(bundle.blob, bundle.filename);
      } catch (e) {
        console.warn('[export] bundle failed', e);
        setFailed(true);
      } finally {
        setBusy(false);
      }
    })();
  }, [spot, rows, busy]);

  return { run, busy, failed };
};
