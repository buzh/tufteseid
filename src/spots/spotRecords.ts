import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';

import { listSpots, subscribeSpots, type SpotRecord } from '../api/spots';
import { currentUserAtom } from '../auth/atoms';

/** Every public one, and the reader's own on top of those when signed in.
 *  Null until the list lands; an empty array means none. */
export const spotRecordsAtom = atom<SpotRecord[] | null>(null);

export const spotsFailedAtom = atom(false);

/** The reader's own, newest change first. */
export const mySpotsAtom = atom((get): SpotRecord[] | null => {
  const user = get(currentUserAtom);
  const records = get(spotRecordsAtom);
  if (!user || !records) return null;
  return records
    .filter((record) => record.owner === user.id)
    .sort((a, b) => b.updated.localeCompare(a.updated));
});

/** Mounted once, by `SpotSurface`. */
export const useSpotRecords = () => {
  const user = useAtomValue(currentUserAtom);
  const setRecords = useSetAtom(spotRecordsAtom);
  const setFailed = useSetAtom(spotsFailedAtom);

  // Signed out as well: a public spot is readable with no account, so the
  // shared drawing layer and the pins are there for a guest too. `user` stays
  // a dependency — signing in adds the reader's own records to the list.
  useEffect(() => {
    setRecords(null);
    setFailed(false);

    let live = true;
    const byId = new Map<string, SpotRecord>();
    const publish = () => setRecords([...byId.values()]);

    listSpots()
      .then((list) => {
        if (!live) return;
        for (const record of list) byId.set(record.id, record);
        publish();
      })
      .catch((err) => {
        if (!live) return;
        console.warn('[spots] list failed', err);
        setFailed(true);
      });

    const unsubscribe = subscribeSpots((action, record) => {
      if (!live) return;
      if (action === 'delete') byId.delete(record.id);
      else byId.set(record.id, record);
      publish();
    });

    return () => {
      live = false;
      unsubscribe();
    };
  }, [user, setRecords, setFailed]);
};
