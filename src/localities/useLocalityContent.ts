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

// The workspace owns both child lists rather than each section fetching
// its own: the header summary, the section counts and the keyboard
// navigation all need them, and a count that lives inside a collapsed
// section can't be read from outside it.
//
// `null` means "still loading" and is distinct from an empty list.

export type LocalityContent<T> = {
  items: T[] | null;
  setItems: Dispatch<SetStateAction<T[] | null>>;
  /** An event arrived while paused and has not been taken in yet. */
  changedElsewhere: boolean;
  /**
   * Go and ask the server again.
   *
   * What a commit does with it: realtime is paused for the length of the
   * session and `Lagre` no longer ends one, so the records the commit just
   * created would otherwise be nowhere — gone from the buffer the overlay was
   * reading them out of, and not yet in the list. This is the one case where
   * reloading under an open buffer is right rather than destructive: the
   * buffer is empty, because it was just played out.
   */
  reload: () => void;
};

/*
 * `paused` is the transaction's half of realtime (§5.6, consequence 5).
 *
 * The subscription stays up — dropping it would mean re-establishing it at
 * commit and finding out what changed by not being told. What stops is
 * *applying* it: an edit session is holding a buffer that describes the list
 * as it was, and reloading underneath that buffer would move cards out from
 * under a drag and re-attach patches to records that no longer say what they
 * said. So a paused event only raises a flag, and the flag becomes the
 * "Lokaliteten er endret et annet sted" line at commit.
 *
 * Last write wins after that, which is acceptable for one author with two
 * tabs. A silent overwrite would not be, which is the whole reason the flag
 * exists rather than nothing at all.
 *
 * **"Elsewhere" means elsewhere**, and that is why the held-back events are a
 * map rather than a boolean. A session writes plenty of its own records while
 * paused — the starter set, a screenshot, a pin the queue just landed — and
 * every one of those comes back as an event about a change the client made
 * itself. A sticky flag counted them, so a brand-new lokalitet's first `Lagre`
 * reliably announced that somebody else had been editing it. What each event
 * is weighed against instead is the state the client already holds: an event
 * that reports the record we are looking at is our own echo, and only an
 * `updated` we have never seen is news. Weighed at *read* time, not on
 * arrival, so it does not matter whether the event or the POST's own response
 * gets back first.
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
  // What arrived while paused, by record: whether it was a delete, and the
  // `updated` stamp it reported. A map, so a record touched five times counts
  // once and the last word wins.
  const [pending, setPending] = useState<
    Map<string, { deleted: boolean; updated: string }>
  >(() => new Map());
  // Realtime events reload too, so "is this response still the newest one"
  // can't be answered by the effect's cleanup alone — a burst of events
  // starts several loads the effect never sees. A sequence number does
  // answer it, and makes a late or failed response harmless instead of
  // something that blanks a list that has since loaded.
  const seq = useRef(0);
  // Read from the subscription handler, which is bound once per lokalitet
  // and must not be torn down and rebuilt every time the stance changes.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const reload = useCallback(() => {
    // Whatever was held back is about to be answered by the server itself.
    // Dropped on the way out rather than when the response lands, so an event
    // that arrives while this is in flight is still weighed.
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

  /*
   * The verdict: did anything happen here that this client did not do?
   *
   * An event whose `updated` is the one we already hold is our own write
   * coming back, and a delete of a record we have already dropped is the
   * same. Everything else is news. Recomputed on `items` as well as on the
   * event counter, which is what makes the answer independent of arrival
   * order: a create whose event beat its own POST response stops counting the
   * moment the response lands and puts the record in the list.
   */
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

  // Leaving the transaction takes in everything that was held back — the
  // commit's own writes included, which is why nothing downstream has to
  // distinguish "somebody else changed it" from "we just saved". `reload`
  // empties the map; where there was no news there is nothing to fetch and
  // the map is dropped on its own.
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
