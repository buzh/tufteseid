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

export const spotScoresAtom = atom<Map<string, SpotScore> | null>(null);

export const myVotesAtom = atom<Map<string, VoteRecord>>(new Map());

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

      if (record.owner === user?.id) {
        setMyVotes((previous) => {
          const next = new Map(previous);
          if (action === 'delete') next.delete(record.spot);
          else next.set(record.spot, record);
          return next;
        });
      }

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
