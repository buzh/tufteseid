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
};

const useCollection = <T extends { id: string; locality: string }>(
  localityId: string,
  list: (id: string) => Promise<T[]>,
  subscribe: (
    handler: (action: 'create' | 'update' | 'delete', rec: T) => void,
  ) => () => void,
  label: string,
): LocalityContent<T> => {
  const [items, setItems] = useState<T[] | null>(null);
  // Realtime events reload too, so "is this response still the newest one"
  // can't be answered by the effect's cleanup alone — a burst of events
  // starts several loads the effect never sees. A sequence number does
  // answer it, and makes a late or failed response harmless instead of
  // something that blanks a list that has since loaded.
  const seq = useRef(0);

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
    reload();
    const unsub = subscribe((_action, rec) => {
      if (rec.locality === localityId) reload();
    });
    return () => {
      // Retire whatever is in flight; the next mount starts a newer one.
      seq.current += 1;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localityId, reload]);

  return { items, setItems };
};

export const useLocalityFinds = (localityId: string) =>
  useCollection<LocalityFindRecord>(
    localityId,
    listLocalityFinds,
    subscribeLocalityFinds,
    'localityFinds',
  );

export const useLocalityAttachments = (localityId: string) =>
  useCollection<AttachmentRecord>(
    localityId,
    listLocalityAttachments,
    subscribeAttachments,
    'localityAttachments',
  );
