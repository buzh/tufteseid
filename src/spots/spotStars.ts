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

/** Tally per spot id. Null until the first list lands; a spot missing from the
 *  map has no stars rather than an unknown tally. */
export const starCountsAtom = atom<Map<string, StarCount> | null>(null);

/** The reader's own stars per spot id. Null until the list lands — the
 *  favourites tab is a list, where "none yet" and "not here yet" differ. */
export const myStarsAtom = atom<Map<string, StarRecord> | null>(null);

export const starsFailedAtom = atom(false);

/** Derived: what the reader has starred, most recently starred first. A spot
 *  whose owner has since made it private is in no readable record list, so it
 *  drops out of the favourites with its star row left alone. */
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

/** Mounted once, by `SpotSurface`. PocketBase publishes no realtime feed on a
 *  view, so `starCounts` is fetched and `stars` subscribed to instead — which
 *  means a tally moves on the reader's own star and picks up everybody else's
 *  at the next full fetch. */
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

      // An admin's list rule covers every account's stars, so the feed carries
      // rows this reader never cast. They move a tally, not the star.
      if (record.owner === user?.id) {
        setMyStars((previous) => {
          const next = new Map(previous);
          if (action === 'delete') next.delete(record.spot);
          else next.set(record.spot, record);
          return next;
        });
      }

      // The star moved, so the tally did too. Only this spot's row is stale.
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
