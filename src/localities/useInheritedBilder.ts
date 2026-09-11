/*
 * The Files a copy did not carry (docs/lokalitet-view.md §7).
 *
 * `copyLocality` brings the Views over as specs and leaves the screenshots and
 * uploads where they are, because a File is bytes and duplicating twenty
 * megabytes per image through the client turns a fork into a multi-minute
 * upload. The parent link is the answer instead: the copy *shows* the
 * original's Files, marked as borrowed, and `Ta med` copies one across when
 * somebody actually wants it. Elective, per image, paid for by whoever asked.
 *
 * Three decisions worth stating, because none of them is in the doc:
 *
 * - **The cards are owner-in-edit only** (`enabled` is the workspace's
 *   `canAdd`). The only verb a borrowed card has is `Ta med`, and `Ta med` is
 *   a write — so in show the whole tail would be cards you can look at and not
 *   act on, which is the opposite of what §2 means by the write verbs being
 *   *absent* rather than greyed. A reader has even less use for them. The
 *   *question* "is the original still there" is asked in both stances, though:
 *   the banner offers `Åpne originalen` in show too, and offering a link that
 *   is known to be dead is worse than not offering it.
 * - **Sourced live, not stubbed.** There is no per-file row in the copy, only
 *   the one `derivedFrom` relation, so a parent that has been deleted or
 *   turned private yields no cards at all rather than broken ones. §7 asks for
 *   a *"Bildet er ikke lenger tilgjengelig"* on the individual card; with
 *   nothing stored per file there is no card to put it on, so the sentence
 *   moves to the banner, said once about the lokalitet.
 * - **Unpinned parents are skipped.** A View whose figure was never rendered
 *   is not offered here — it is not a File, and the copy already has its spec.
 *   `isPinned` also keeps a genuinely fileless row out of a card whose only
 *   verb would be to download nothing.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type AttachmentRecord,
  listLocalityAttachments,
} from '../api/attachments';
import { getLocality, type LocalityRecord } from '../api/localities';
import { isPinned, viewSpecOf } from './viewSpec';

/**
 * Which parent File a copied one came from. Lives in `meta` rather than in a
 * column of its own for the same reason `renderedAt` does: provenance already
 * has a home there, and this needs no schema change.
 */
const takenFromOf = (rec: AttachmentRecord): string | null => {
  const v = rec.meta?.takenFrom;
  return typeof v === 'string' && v !== '' ? v : null;
};

export type InheritedBilder = {
  /** The original's Files, minus the ones already taken. */
  items: AttachmentRecord[];
  /** The original could not be read — deleted, or no longer shared. */
  unavailable: boolean;
};

export const useInheritedBilder = (
  locality: LocalityRecord,
  own: AttachmentRecord[] | null,
  enabled: boolean,
): InheritedBilder => {
  const parentId = locality.derivedFrom || null;
  const [parentFiles, setParentFiles] = useState<AttachmentRecord[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  // Same guard as `useLocalityContent`: a late response must not overwrite a
  // newer one. Cheaper here — this list is fetched once per lokalitet rather
  // than on every realtime event — but the parent can change under a swap
  // between two copies without the component unmounting.
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setParentFiles([]);
    setUnavailable(false);
    if (!parentId) return;
    void (async () => {
      // Two requests rather than one, and the first is asked even in show:
      // a parent that has been deleted or unshared does not make the
      // attachment list *fail*, the read rule just filters every row out,
      // which is indistinguishable from an original that had no Files.
      // Whether the record itself still resolves is the question the banner
      // has, so it is the one asked, and it is asked in both stances.
      try {
        await getLocality(parentId);
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

  return { items, unavailable };
};
