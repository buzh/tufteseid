// The original's Files, which `copyLocality` leaves behind. Read live off
// `derivedFrom` — nothing per file is stored in the copy — so an unreadable
// parent yields no cards and one banner. The cards are owner-in-edit only,
// `Ta med` being their one verb, but the availability check runs in both
// stances, because the banner's `Åpne originalen` does.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type AttachmentRecord,
  listLocalityAttachments,
} from '../api/attachments';
import { creditOf, getLocality, type LocalityRecord } from '../api/localities';
import { isPinned, viewSpecOf } from './viewSpec';

/** Which parent File a copied one came from; in `meta`, no schema change. */
const takenFromOf = (rec: AttachmentRecord): string | null => {
  const v = rec.meta?.takenFrom;
  return typeof v === 'string' && v !== '' ? v : null;
};

export type InheritedBilder = {
  /** The original's Files, minus the ones already taken. */
  items: AttachmentRecord[];
  /** The original could not be read — deleted, or no longer shared. */
  unavailable: boolean;
  /**
   * Whose pictures these are. `Ta med` writes it onto the copy, because a
   * borrowed composition is still the original author's work and the legend
   * on the way out has to say so long after the original is gone.
   */
  owner: string | null;
};

export const useInheritedBilder = (
  locality: LocalityRecord,
  own: AttachmentRecord[] | null,
  enabled: boolean,
): InheritedBilder => {
  const parentId = locality.derivedFrom || null;
  const [parentFiles, setParentFiles] = useState<AttachmentRecord[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [owner, setOwner] = useState<string | null>(null);
  // The parent can change under a swap between two copies, without unmount.
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setParentFiles([]);
    setUnavailable(false);
    setOwner(null);
    if (!parentId) return;
    void (async () => {
      // Asked separately: an unreadable parent does not fail the attachment
      // list, the read rule just filters every row out.
      try {
        const parent = await getLocality(parentId);
        if (seq.current !== mine) return;
        setOwner(creditOf(parent));
      } catch (e) {
        if (seq.current !== mine) return;
        console.warn('[inheritedBilder] original unreadable', e);
        setUnavailable(true);
        return;
      }
      if (seq.current !== mine || !enabled) return;
      try {
        const rows = await listLocalityAttachments(parentId);
        if (seq.current !== mine) return;
        // Files only, and pinned: the copy already carries every spec.
        setParentFiles(
          rows.filter((rec) => viewSpecOf(rec) == null && isPinned(rec)),
        );
      } catch (e) {
        // Not `unavailable`: the original is there, this one call failed.
        console.warn('[inheritedBilder] load failed', e);
      }
    })();
    return () => {
      seq.current += 1;
    };
  }, [parentId, enabled]);

  const items = useMemo(() => {
    if (parentFiles.length === 0) return parentFiles;
    const taken = new Set<string>();
    for (const rec of own ?? []) {
      const from = takenFromOf(rec);
      if (from) taken.add(from);
    }
    return taken.size === 0
      ? parentFiles
      : parentFiles.filter((rec) => !taken.has(rec.id));
  }, [parentFiles, own]);

  return { items, unavailable, owner };
};
