import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AttachmentRecord,
  listLocalityAttachments,
  subscribeAttachments,
} from '../api/attachments';
import {
  listLocalityFinds,
  LocalityFindRecord,
  subscribeLocalityFinds,
} from '../api/localityFinds';

// The workspace owns both child lists rather than each section fetching its
// own. `items === null` is still loading, distinct from an empty list.

export type LocalityContent<T> = {
  items: T[] | null;
  setItems: Dispatch<SetStateAction<T[] | null>>;
  /** An event arrived while paused and has not been taken in yet. */
  changedElsewhere: boolean;
  /** A commit needs this: realtime is paused for the length of the session, so
   * the records it just wrote are in neither the buffer nor the list. */
  reload: () => void;
};

/*
 * `paused` is the edit transaction's half of realtime: the subscription stays
 * up, but applying it would move cards out from under a drag. A held-back
 * event only raises the flag behind the "endret et annet sted" line at commit,
 * and last write wins after that. They are a map rather than a boolean because
 * a session's own writes echo back too, and each is weighed against what the
 * client already holds at read time, so either may land first.
 */
const useCollection = <
  T extends { id: string; locality: string; updated: string },
>(
  localityId: string,
  list: (id: string) => Promise<T[]>,
  subscribe: (
    handler: (action: 'create' | 'update' | 'delete', rec: T) => void,
  ) => () => void,
  label: string,
  paused: boolean,
): LocalityContent<T> => {
  const [items, setItems] = useState<T[] | null>(null);
  // By record, so five touches count once.
  const [pending, setPending] = useState<
    Map<string, { deleted: boolean; updated: string }>
  >(() => new Map());
  // A burst of realtime events starts several loads the effect's cleanup never
  // sees; the sequence makes a late or failed response harmless.
  const seq = useRef(0);
  // Read from the handler, bound once per lokalitet, not per stance change.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const reload = useCallback(() => {
    // Dropped on the way out, so an event arriving in flight is still weighed.
    setPending((prev) => (prev.size > 0 ? new Map() : prev));
    const mine = ++seq.current;
    list(localityId)
      .then((data) => {
        if (seq.current === mine) setItems(data);
      })
      .catch((e) => {
        if (seq.current !== mine) return;
        console.warn(`[${label}] load failed`, e);
        setItems([]);
      });
    // `list` and `label` are module-level constants at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localityId]);

  useEffect(() => {
    setItems(null);
    reload();
    const unsub = subscribe((action, rec) => {
      if (rec.locality !== localityId) return;
      if (!pausedRef.current) {
        reload();
        return;
      }
      setPending((prev) => {
        const next = new Map(prev);
        next.set(rec.id, {
          deleted: action === 'delete',
          updated: rec.updated,
        });
        return next;
      });
    });
    return () => {
      // Retire whatever is in flight; the next mount starts a newer one.
      seq.current += 1;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localityId, reload]);

  // An event whose `updated` is the one already held is our own write coming
  // back. Recomputed on `items`, which is what frees it from arrival order.
  const changedElsewhere = useMemo(() => {
    if (pending.size === 0) return false;
    const held = new Map((items ?? []).map((rec) => [rec.id, rec.updated]));
    for (const [id, event] of pending) {
      if (event.deleted ? held.has(id) : held.get(id) !== event.updated) {
        return true;
      }
    }
    return false;
  }, [pending, items]);

  // Leaving the transaction takes in everything held back, the commit's own
  // writes included; `reload` empties the map.
  useEffect(() => {
    if (paused || pending.size === 0) return;
    if (changedElsewhere) reload();
    else setPending(new Map());
  }, [paused, pending, changedElsewhere, reload]);

  return { items, setItems, changedElsewhere, reload };
};

export const useLocalityFinds = (localityId: string, paused: boolean) =>
  useCollection<LocalityFindRecord>(
    localityId,
    listLocalityFinds,
    subscribeLocalityFinds,
    'localityFinds',
    paused,
  );

export const useLocalityAttachments = (localityId: string, paused: boolean) =>
  useCollection<AttachmentRecord>(
    localityId,
    listLocalityAttachments,
    subscribeAttachments,
    'localityAttachments',
    paused,
  );
