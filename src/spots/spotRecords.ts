// The spots this session may see, held once for everything that reads them.
//
// There are two readers now — the pins on the map and the index in the band —
// and they must not be two fetches. `listSpots` is a full list and
// `subscribeSpots` is an SSE stream against the same collection: asking twice
// would double both, and the second copy would drift from the first between a
// realtime event and whichever consumer happened to refetch. So the fetch and
// the subscription are here, the records are an atom, and a surface that wants
// them subscribes to it.
//
// Signed out there is no list at all. What the server will answer for a guest
// is one record at a time, by code (`shareLink.ts`) — the list is the index of
// your own, and a guest has none.

import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';

import { listSpots, subscribeSpots, type SpotRecord } from '../api/spots';
import { currentUserAtom } from '../auth/atoms';

/**
 * Every spot the signed-in reader may see: their own and every public one.
 * Null until the list has arrived, and again once they sign out — the menu
 * tells "still coming" from "you have none", and an empty array is the second
 * of those.
 */
export const spotRecordsAtom = atom<SpotRecord[] | null>(null);

/**
 * The list did not come. Its own atom rather than an empty array, because an
 * empty list is an answer and this is the absence of one: told as emptiness it
 * would read as "you have no lokaliteter", which is the one thing it does not
 * mean.
 */
export const spotsFailedAtom = atom(false);

/**
 * The reader's own, newest change first. Sorted here rather than trusted off
 * the server's `-updated`: a realtime event arrives after the list and would
 * otherwise sit wherever the record already stood.
 */
export const mySpotsAtom = atom((get): SpotRecord[] | null => {
  const user = get(currentUserAtom);
  const records = get(spotRecordsAtom);
  if (!user || !records) return null;
  return records
    .filter((record) => record.owner === user.id)
    .sort((a, b) => b.updated.localeCompare(a.updated));
});

/**
 * Fill the atoms above and keep them filled. Mounted once, by `SpotSurface`,
 * which is the surface that mounts with the map.
 */
export const useSpotRecords = () => {
  const user = useAtomValue(currentUserAtom);
  const setRecords = useSetAtom(spotRecordsAtom);
  const setFailed = useSetAtom(spotsFailedAtom);

  useEffect(() => {
    // Both states cleared first, so a sign-out empties the map immediately and
    // a change of account never shows the previous one's records while the new
    // list is in flight.
    setRecords(null);
    setFailed(false);
    if (!user) return;

    let live = true;
    // Keyed rather than appended: a realtime update of a record already in the
    // list is the same row with new fields, and `Map.set` leaves it where it
    // was rather than adding a second one.
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
