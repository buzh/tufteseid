import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useState } from 'react';
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

  const reload = useCallback(() => {
    let cancelled = false;
    list(localityId)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((e) => {
        console.warn(`[${label}] load failed`, e);
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
    // `list` and `label` are module-level constants at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localityId]);

  useEffect(() => {
    setItems(null);
    const cancel = reload();
    const unsub = subscribe((_action, rec) => {
      if (rec.locality === localityId) reload();
    });
    return () => {
      cancel();
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
