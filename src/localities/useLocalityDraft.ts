import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AttachmentRecord,
  createAttachmentSpec,
  deleteAttachment,
  updateAttachment,
} from '../api/attachments';
import { LocalityRecord, updateLocality } from '../api/localities';
import {
  createLocalityFind,
  deleteLocalityFind,
  updateLocalityFind,
} from '../api/localityFinds';
import {
  clearDraft,
  type DraftLocality,
  isDirty,
  loadDraft,
  type LocalityDraft,
  localityFieldsOf,
  localityPatchOf,
  newDraft,
  saveDraft,
} from './draft';

export type CommitResult = {
  /** Everything got through. False leaves the remainder in the buffer. */
  ok: boolean;
  /** How many writes failed, for the toast. */
  failed: number;
  /** The specs that landed, so the caller can hand them to the pin queue. */
  created: AttachmentRecord[];
};

/**
 * The edit transaction's React half (docs/lokalitet-view.md §5.6).
 *
 * `draft.ts` is the data — what a buffer is, how to read it back, how to put
 * it on disk. This is the part that has to live in a component: when the
 * buffer opens and closes, when it is written to `localStorage`, and what
 * `Lagre` and `Avbryt` actually do.
 *
 * Three properties are load-bearing:
 *
 * - **A recovered draft restores itself.** Finding one in `localStorage` is
 *   already the answer to "did this session end badly"; making the user press
 *   a second button to get their own work back would be asking them to
 *   confirm a fact. The banner (§5.7, rank 1) says it happened and offers
 *   `Forkast`, which is the only decision left to make.
 * - **The commit is resumable.** N writes with no transaction behind them can
 *   half-succeed, so each one is removed from the buffer as it lands. A second
 *   `Lagre` after a dropped connection retries exactly the remainder — never
 *   the funn that already exists.
 * - **`Avbryt` writes only to compensate.** The buffered edits were never
 *   sent, so rolling them back is local and instant; the only network traffic
 *   is deleting the Files this session wrote eagerly, which is the narrow edge
 *   §5.6 admits to.
 */
export const useLocalityDraft = ({
  locality,
  userId,
  recoverable,
  /** Push buffered lokalitet fields back onto the live record and the map. */
  applyLocality,
}: {
  locality: LocalityRecord;
  userId: string | null;
  /** Whether this user could commit a recovered buffer. `mayEdit`. */
  recoverable: boolean;
  applyLocality: (fields: DraftLocality) => void;
}) => {
  const [draft, setDraft] = useState<LocalityDraft | null>(null);
  /** When a buffer was recovered from disk, for the banner. Null otherwise. */
  const [restoredAt, setRestoredAt] = useState<number | null>(null);

  // The commit and the rollback read the buffer from a timer-free callback
  // that must not re-identify on every keystroke in the name field.
  const draftRef = useRef<LocalityDraft | null>(draft);
  draftRef.current = draft;
  const applyRef = useRef(applyLocality);
  applyRef.current = applyLocality;

  const localityId = locality.id;

  /*
   * Recovery, on arrival.
   *
   * Keyed on the id alone: re-running this when the record's own fields
   * change would restore the buffer over the edits it just made. The stored
   * copy is only read once per lokalitet, which is also what makes it safe to
   * write on every mutation below.
   */
  useEffect(() => {
    setDraft(null);
    setRestoredAt(null);
    // A reader's own browser can hold a buffer for a lokalitet they have
    // since lost edit rights on. Leave it where it is rather than restoring
    // a session that cannot be committed.
    if (!recoverable) return;
    const stored = loadDraft(localityId);
    if (!stored) return;
    setDraft(stored);
    setRestoredAt(stored.startedAt);
    applyRef.current(stored.locality);
  }, [localityId, recoverable]);

  // Persist on every change. No debounce: the two writes that could be
  // frequent are already debounced upstream — the pen settles for 700 ms
  // before it hands over geometry, and text fields commit on blur.
  useEffect(() => {
    if (!draft) return;
    if (isDirty(draft)) saveDraft(draft);
    else clearDraft(draft.localityId);
  }, [draft]);

  /** `Rediger`: open a buffer, unless one was recovered and is already open. */
  const begin = useCallback(() => {
    setDraft((cur) => cur ?? newDraft(locality));
  }, [locality]);

  /** Apply an updater to the buffer. A no-op when there is no buffer. */
  const mutate = useCallback(
    (fn: (d: LocalityDraft) => LocalityDraft) =>
      setDraft((cur) => (cur ? fn(cur) : cur)),
    [],
  );

  const commit = useCallback(async (): Promise<CommitResult> => {
    const d = draftRef.current;
    if (!d || !userId) {
      setDraft(null);
      setRestoredAt(null);
      clearDraft(localityId);
      return { ok: true, failed: 0, created: [] };
    }

    // The remainder, narrowed as each write lands. Cloned up front so a
    // failure halfway leaves a buffer that describes exactly what is left.
    const rest: LocalityDraft = {
      ...d,
      finds: { ...d.finds },
      newFinds: { ...d.newFinds },
      findDeletes: [...d.findDeletes],
      attachments: { ...d.attachments },
      newSpecs: { ...d.newSpecs },
      attachmentDeletes: [...d.attachmentDeletes],
      // Whatever happens, the Files are already on the server and are no
      // longer this transaction's to compensate.
      eagerIds: [],
    };
    let failed = 0;
    const created: AttachmentRecord[] = [];

    const patch = localityPatchOf(d);
    if (patch) {
      try {
        const updated = await updateLocality(localityId, patch);
        rest.baseLocality = localityFieldsOf(updated);
        rest.locality = localityFieldsOf(updated);
      } catch (e) {
        console.warn('[localityDraft] locality commit failed', e);
        failed++;
      }
    }

    // Deletions first: a session that deleted a funn and then drew a
    // replacement should not have both on the list for the length of a
    // round trip.
    for (const id of d.findDeletes) {
      try {
        await deleteLocalityFind(id);
        rest.findDeletes = rest.findDeletes.filter((x) => x !== id);
      } catch (e) {
        console.warn('[localityDraft] funn delete failed', e);
        failed++;
      }
    }
    for (const [id, body] of Object.entries(d.finds)) {
      try {
        await updateLocalityFind(id, body);
        delete rest.finds[id];
      } catch (e) {
        console.warn('[localityDraft] funn update failed', e);
        failed++;
      }
    }
    for (const [tmp, body] of Object.entries(d.newFinds)) {
      try {
        await createLocalityFind({ locality: localityId, ...body }, userId);
        delete rest.newFinds[tmp];
      } catch (e) {
        console.warn('[localityDraft] funn create failed', e);
        failed++;
      }
    }

    for (const id of d.attachmentDeletes) {
      try {
        await deleteAttachment(id);
        rest.attachmentDeletes = rest.attachmentDeletes.filter((x) => x !== id);
      } catch (e) {
        console.warn('[localityDraft] bilde delete failed', e);
        failed++;
      }
    }
    for (const [id, body] of Object.entries(d.attachments)) {
      try {
        await updateAttachment(id, body);
        delete rest.attachments[id];
      } catch (e) {
        console.warn('[localityDraft] bilde update failed', e);
        failed++;
      }
    }
    for (const [tmp, body] of Object.entries(d.newSpecs)) {
      try {
        const rec = await createAttachmentSpec(
          {
            locality: localityId,
            kind: body.kind,
            caption: body.caption,
            meta: body.meta,
          },
          userId,
        );
        // The exhibit position the buffer gave it, but only where the author
        // put it there: `createAttachmentSpec` mints its own clock-derived
        // `sort`, which is the right answer for a record created now and the
        // wrong one for a card that has since been dragged or hidden.
        const arranged = body.sort !== body.bornSort || body.hidden;
        const placed = arranged
          ? await updateAttachment(rec.id, {
              sort: body.sort,
              hidden: body.hidden,
            }).catch(() => rec)
          : rec;
        created.push(placed);
        delete rest.newSpecs[tmp];
      } catch (e) {
        console.warn('[localityDraft] spec create failed', e);
        failed++;
      }
    }

    if (failed > 0) {
      setDraft(rest);
      return { ok: false, failed, created };
    }
    setDraft(null);
    setRestoredAt(null);
    clearDraft(localityId);
    return { ok: true, failed: 0, created };
  }, [localityId, userId]);

  /**
   * `Avbryt`. Returns how many eager Files could not be taken back.
   *
   * The buffer goes first and the network second on purpose: the user has
   * asked for their edits to be gone, and they are gone the moment the state
   * clears. Whether the screenshot they took also went is a slower question
   * and not one to hold the interface open for.
   */
  const rollback = useCallback(async (): Promise<number> => {
    const d = draftRef.current;
    setDraft(null);
    setRestoredAt(null);
    if (!d) return 0;
    applyRef.current(d.baseLocality);
    clearDraft(d.localityId);
    let stuck = 0;
    for (const id of d.eagerIds) {
      try {
        await deleteAttachment(id);
      } catch (e) {
        console.warn('[localityDraft] eager file rollback failed', e);
        stuck++;
      }
    }
    return stuck;
  }, []);

  return { draft, restoredAt, begin, mutate, commit, rollback };
};
