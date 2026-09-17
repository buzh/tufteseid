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
  /** Temp spec id → the real one, for callers holding an id the buffer minted. */
  renamedSpecs: Map<string, string>;
};

/**
 * The edit transaction's React half: when the buffer opens and closes, when it
 * reaches `localStorage`, and what `Lagre` and `Avbryt` do. `draft.ts` is the
 * data half.
 *
 * The commit must stay resumable: N writes with no transaction behind them can
 * half-succeed, so each is removed from the buffer as it lands and a second
 * `Lagre` retries exactly the remainder. `Avbryt` touches the network only to
 * delete the Files this session wrote eagerly.
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

  // `commit` and `rollback` must not re-identify on every keystroke, so they
  // read the buffer through a ref rather than closing over it.
  const draftRef = useRef<LocalityDraft | null>(draft);
  draftRef.current = draft;
  const applyRef = useRef(applyLocality);
  applyRef.current = applyLocality;

  const localityId = locality.id;

  // Recovery, on arrival. Must stay keyed on the id alone: re-running when the
  // record's own fields change would restore the buffer over the edits it just
  // made.
  useEffect(() => {
    setDraft(null);
    setRestoredAt(null);
    // A browser can hold a buffer for a lokalitet its owner has since lost
    // edit rights on; leave it rather than restoring an uncommittable session.
    if (!recoverable) return;
    const stored = loadDraft(localityId);
    if (!stored) return;
    setDraft(stored);
    setRestoredAt(stored.startedAt);
    applyRef.current(stored.locality);
  }, [localityId, recoverable]);

  // No debounce: the two frequent writers are debounced upstream — the pen
  // settles for 700 ms before handing over geometry, text fields commit on blur.
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
      // The Files are already on the server, so they are no longer this
      // transaction's to compensate.
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

    // Deletions first, so a deleted funn and its replacement are never both on
    // the list for the length of a round trip.
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
    // Temp funn id → the real one. PocketBase rejects a relation to a record
    // that does not exist, so the funn are written before anything naming them.
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
    // dropped rather than sent, so the record still saves without it.
    const resolve = (
      ids: string[] | undefined,
      map: Map<string, string>,
    ): string[] =>
      (ids ?? []).map((id) => map.get(id) ?? id).filter((id) => !isDraftId(id));
    for (const [id, body] of Object.entries(d.attachments)) {
      try {
        // `funn` may name a funn invented in the same session, so it needs the
        // same translation the specs below get.
        const rec = await updateAttachment(id, {
          ...body,
          funn: resolve(body.funn, realFindId),
        });
        // A `meta` patch means a re-drawn sketch, whose figure is now a picture
        // of the previous drawing — but placing an upload is a `meta` patch
        // too, and a File has nothing to render, so `viewSpecOf` must gate it
        // or the queue lights a failure face on a record that is fine.
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
            caption: body.caption,
            // A scene names its members twice, in `over` and in `meta.layers`,
            // so both halves need the same translation. One pass suffices
            // because `newSpecs` keeps insertion order and a scene can only
            // name members that existed when it was kept.
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
        // `createAttachmentSpec` mints its own clock-derived `sort`, which is
        // right for a record created now; only override it where the author
        // actually dragged or hid the card.
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
   * `Avbryt`. Returns how many eager Files could not be taken back. Clears the
   * buffer before touching the network, so the edits are gone immediately.
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
