import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';

import { listSpots, subscribeSpots, type SpotRecord } from '../api/spots';
import { currentUserAtom } from '../auth/atoms';

/** The reader's own and every public one. Null until the list lands and while
 *  signed out; an empty array means none. */
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

  useEffect(() => {
    setRecords(null);
    setFailed(false);
    if (!user) return;

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
