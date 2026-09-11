import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
 */
const useCollection = <T extends { id: string; locality: string }>(
  localityId: string,
  list: (id: string) => Promise<T[]>,
  subscribe: (
    handler: (action: 'create' | 'update' | 'delete', rec: T) => void,
  ) => () => void,
  label: string,
  paused: boolean,
): LocalityContent<T> => {
  const [items, setItems] = useState<T[] | null>(null);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
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
    setChangedElsewhere(false);
    reload();
    const unsub = subscribe((_action, rec) => {
      if (rec.locality !== localityId) return;
      if (pausedRef.current) setChangedElsewhere(true);
      else reload();
    });
    return () => {
      // Retire whatever is in flight; the next mount starts a newer one.
      seq.current += 1;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localityId, reload]);

  // Leaving the transaction takes in everything that was held back — the
  // commit's own writes included, which is why nothing here has to
  // distinguish "somebody else changed it" from "we just saved".
  useEffect(() => {
    if (paused) return;
    if (!changedElsewhere) return;
    setChangedElsewhere(false);
    reload();
  }, [paused, changedElsewhere, reload]);

  return { items, setItems, changedElsewhere };
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
