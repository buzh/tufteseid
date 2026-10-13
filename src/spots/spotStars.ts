import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';

import type { SpotRecord } from '../api/spots';
import {
  getStarCount,
  listMyStars,
  listStarCounts,
  subscribeStars,
  type StarCount,
  type StarRecord,
} from '../api/stars';
import { currentUserAtom } from '../auth/atoms';
import { spotRecordsAtom } from './spotRecords';

export const starCountsAtom = atom<Map<string, StarCount> | null>(null);

export const myStarsAtom = atom<Map<string, StarRecord> | null>(null);

export const starsFailedAtom = atom(false);

export const favouriteSpotsAtom = atom((get): SpotRecord[] | null => {
  const stars = get(myStarsAtom);
  const records = get(spotRecordsAtom);
  if (!stars || !records) return null;
  const byId = new Map(records.map((record) => [record.id, record]));
  return [...stars.values()]
    .sort((a, b) => b.created.localeCompare(a.created))
    .map((star) => byId.get(star.spot))
    .filter((record) => record != null);
});

export const useSpotStars = () => {
  const user = useAtomValue(currentUserAtom);
  const setCounts = useSetAtom(starCountsAtom);
  const setMyStars = useSetAtom(myStarsAtom);
  const setFailed = useSetAtom(starsFailedAtom);

  useEffect(() => {
    setCounts(null);
    setMyStars(null);
    setFailed(false);

    let live = true;
    const byId = new Map<string, StarCount>();
    const publish = () => setCounts(new Map(byId));

    listStarCounts()
      .then((list) => {
        if (!live) return;
        for (const count of list) byId.set(count.spot, count);
        publish();
      })
      .catch((err) => {
        if (!live) return;
        console.warn('[stars] counts failed', err);
      });

    listMyStars()
      .then((list) => {
        if (!live) return;
        setMyStars(new Map(list.map((star) => [star.spot, star])));
      })
      .catch((err) => {
        if (!live) return;
        console.warn('[stars] own stars failed', err);
        setFailed(true);
      });

    const unsubscribe = subscribeStars((action, record) => {
      if (!live) return;

      if (record.owner === user?.id) {
        setMyStars((previous) => {
          const next = new Map(previous);
          if (action === 'delete') next.delete(record.spot);
          else next.set(record.spot, record);
          return next;
        });
      }

      void getStarCount(record.spot).then((count) => {
        if (!live) return;
        if (count) byId.set(record.spot, count);
        else byId.delete(record.spot);
        publish();
      });
    });

    return () => {
      live = false;
      unsubscribe();
    };
  }, [user, setCounts, setMyStars, setFailed]);
};
