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
  isDraftId,
  loadDraft,
  type LocalityDraft,
  localityFieldsOf,
  localityPatchOf,
  newDraft,
  saveDraft,
} from './draft';
import { remapSceneMeta } from './sceneSpec';
import { viewSpecOf } from './viewSpec';

export type CommitResult = {
  /** Everything got through. False leaves the remainder in the buffer. */
  ok: boolean;
  /** How many writes failed, for the toast. */
  failed: number;
  /**
   * The records whose pixels are owed, for the caller to hand to the pin
   * queue: the specs this commit created, and any sketch it re-drew.
   */
  created: AttachmentRecord[];
  /**
   * Temp spec id → the real one, for callers holding an id the buffer minted.
   * A shown sketch is remembered by id, and the id it went up under was a
   * draft id this commit has just replaced.
   */
  renamedSpecs: Map<string, string>;
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
      return { ok: true, failed: 0, created: [], renamedSpecs: new Map() };
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
    /*
     * Temp id → the real one, for the sketches below.
     *
     * A sketch kept in the same session that invented the funn it is about
     * holds that funn's *temp* id, and posting it verbatim would be a relation
     * to a record that does not exist — which PocketBase rejects, so the whole
     * sketch would fail over a field that is not what the author was doing.
     * The funn are written first, so by the time the specs go out every id
     * that was going to become real has.
     */
    const realFindId = new Map<string, string>();
    for (const [tmp, body] of Object.entries(d.newFinds)) {
      try {
        const rec = await createLocalityFind(
          { locality: localityId, ...body },
          userId,
        );
        realFindId.set(tmp, rec.id);
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
    // A relation to something the buffer invented and could not write is
    // dropped rather than sent: a sketch about a funn whose create just failed
    // is still a sketch, and refusing to save it would lose the drawing over
    // the label on it.
    const resolve = (
      ids: string[] | undefined,
      map: Map<string, string>,
    ): string[] =>
      (ids ?? []).map((id) => map.get(id) ?? id).filter((id) => !isDraftId(id));
    for (const [id, body] of Object.entries(d.attachments)) {
      try {
        // Filing an existing bilde under a funn invented in the same session
        // is the ordinary case for step 9's editor, so this patch needs the
        // same translation the specs below get. `funn` is always in the body
        // (`attachmentBaseOf`), so this is a round trip for every other edit
        // rather than a write only the editor triggers.
        const rec = await updateAttachment(id, {
          ...body,
          funn: resolve(body.funn, realFindId),
        });
        // A sketch that has been drawn on again is the one patch that changes
        // what the record *is* rather than how it is displayed, so its figure
        // is now a picture of the previous drawing. Onto the queue with the
        // new specs: the caller does not need to know which of the two a
        // record got there by, only that its pixels are owed.
        //
        // `viewSpecOf` rather than `body.meta` alone, since step 7: placing an
        // upload (§13.5) is a `meta` patch too, and a File has nothing behind
        // it to render — the queue would take the job only to mark it `empty`
        // and light a failure face on a record that is perfectly fine.
        if (body.meta && viewSpecOf(rec)) created.push(rec);
        delete rest.attachments[id];
      } catch (e) {
        console.warn('[localityDraft] bilde update failed', e);
        failed++;
      }
    }
    const realSpecId = new Map<string, string>();
    for (const [tmp, body] of Object.entries(d.newSpecs)) {
      try {
        const rec = await createAttachmentSpec(
          {
            locality: localityId,
            kind: body.kind,
            /*
             * A scene names its members twice — in `over` and in `meta.layers`
             * — so both halves need the same translation (§13.7). The
             * relation's is `resolve` below; this is the one in JSON, and
             * without it a scene kept in the same session as the extract under
             * it would point at a `draft:` id nothing will ever answer for.
             *
             * Insertion order is what makes one pass enough: `newSpecs` is
             * written in the order the specs were kept, a scene can only name
             * members that already existed when it was kept, so every id it
             * holds is already in `realSpecId` by the time it comes round.
             */
            meta:
              body.kind === 'scene'
                ? remapSceneMeta(body.meta, (id) =>
                    isDraftId(id) ? (realSpecId.get(id) ?? null) : id,
                  )
                : body.meta,
            funn: resolve(body.funn, realFindId),
            over: resolve(body.over, realSpecId),
          },
          userId,
        );
        realSpecId.set(tmp, rec.id);
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
      return { ok: false, failed, created, renamedSpecs: realSpecId };
    }
    setDraft(null);
    setRestoredAt(null);
    clearDraft(localityId);
    return { ok: true, failed: 0, created, renamedSpecs: realSpecId };
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
