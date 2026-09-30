import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';

import type { SpotRecord } from '../api/spots';
import {
  getSpotScore,
  listMyVotes,
  listSpotScores,
  subscribeVotes,
  type SpotScore,
  type VoteRecord,
} from '../api/votes';
import { currentUserAtom } from '../auth/atoms';
import { spotRecordsAtom } from './spotRecords';

/** Tally per spot id. Null until the first list lands; a spot missing from the
 *  map has no votes rather than an unknown score. */
export const spotScoresAtom = atom<Map<string, SpotScore> | null>(null);

/** The reader's own vote per spot id. Empty when signed out — the list rule
 *  hands a guest nothing. */
export const myVotesAtom = atom<Map<string, VoteRecord>>(new Map());

/** Every public spot, best first, `updated` breaking a tie so the order is
 *  stable rather than the fetch's. Unvoted ones are in it at zero, and the
 *  tallies are not waited on: unranked reads better than a spinner. */
export const popularSpotsAtom = atom((get): SpotRecord[] | null => {
  const records = get(spotRecordsAtom);
  if (!records) return null;
  const scores = get(spotScoresAtom);
  const scoreOf = (spot: SpotRecord) => scores?.get(spot.id)?.score ?? 0;
  return records
    .filter((record) => record.visibility === 'public')
    .sort(
      (a, b) => scoreOf(b) - scoreOf(a) || b.updated.localeCompare(a.updated),
    );
});

/** Mounted once, by `SpotSurface`. PocketBase publishes no realtime feed on a
 *  view, so `spotScores` is fetched and `votes` subscribed to instead — which
 *  means a tally moves on the reader's own vote and picks up everybody else's
 *  at the next full fetch. */
export const useSpotScores = () => {
  const user = useAtomValue(currentUserAtom);
  const setScores = useSetAtom(spotScoresAtom);
  const setMyVotes = useSetAtom(myVotesAtom);

  useEffect(() => {
    setScores(null);
    setMyVotes(new Map());

    let live = true;
    const byId = new Map<string, SpotScore>();
    const publish = () => setScores(new Map(byId));

    listSpotScores()
      .then((list) => {
        if (!live) return;
        for (const score of list) byId.set(score.spot, score);
        publish();
      })
      .catch((err) => {
        if (!live) return;
        console.warn('[votes] scores failed', err);
      });

    listMyVotes()
      .then((list) => {
        if (!live) return;
        setMyVotes(new Map(list.map((vote) => [vote.spot, vote])));
      })
      .catch((err) => {
        if (!live) return;
        console.warn('[votes] own votes failed', err);
      });

    const unsubscribe = subscribeVotes((action, record) => {
      if (!live) return;

      // An admin's list rule covers every account's votes, so the feed
      // carries rows this reader never cast. They move a tally, not a thumb.
      if (record.owner === user?.id) {
        setMyVotes((previous) => {
          const next = new Map(previous);
          if (action === 'delete') next.delete(record.spot);
          else next.set(record.spot, record);
          return next;
        });
      }

      // The vote moved, so the tally did too. Only this spot's row is stale.
      void getSpotScore(record.spot).then((score) => {
        if (!live) return;
        if (score) byId.set(record.spot, score);
        else byId.delete(record.spot);
        publish();
      });
    });

    return () => {
      live = false;
      unsubscribe();
    };
  }, [user, setScores, setMyVotes]);
};
