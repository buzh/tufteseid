import { pb } from './pocketbase';

const COLLECTION = 'votes';
const SCORES = 'spotScores';

export type VoteDirection = 'up' | 'down';

export type VoteRecord = {
  id: string;
  owner: string;
  spot: string;
  direction: VoteDirection;
  created: string;
  updated: string;
};

export type SpotScore = {

  id: string;
  spot: string;
  votes: number;
  up: number;
  down: number;
  score: number;
};

const isAlreadyVoted = (err: unknown): boolean =>
  (err as { response?: { data?: Record<string, { code?: string }> } })?.response
    ?.data?.owner?.code === 'validation_not_unique';

export const listMyVotes = async (): Promise<VoteRecord[]> => {
  const owner = pb.authStore.record?.id;
  return owner
    ? await pb.collection(COLLECTION).getFullList<VoteRecord>({
        filter: pb.filter('owner = {:owner}', { owner }),
      })
    : [];
};

export const listSpotScores = async (): Promise<SpotScore[]> =>
  await pb.collection(SCORES).getFullList<SpotScore>({ sort: '-score' });

export const getSpotScore = async (
  spotId: string,
): Promise<SpotScore | null> => {
  try {
    return await pb
      .collection(SCORES)
      .getOne<SpotScore>(spotId, { requestKey: null });
  } catch {
    return null;
  }
};

export const castVote = async (
  spotId: string,
  ownerId: string,
  direction: VoteDirection,
): Promise<VoteRecord> => {
  try {
    return await pb
      .collection(COLLECTION)
      .create<VoteRecord>({ owner: ownerId, spot: spotId, direction });
  } catch (err) {
    if (!isAlreadyVoted(err)) throw err;
    const existing = await pb
      .collection(COLLECTION)
      .getFirstListItem<VoteRecord>(
        pb.filter('owner = {:owner} && spot = {:spot}', {
          owner: ownerId,
          spot: spotId,
        }),
        { requestKey: null },
      );
    return await pb
      .collection(COLLECTION)
      .update<VoteRecord>(existing.id, { direction });
  }
};

export const retractVote = async (id: string): Promise<void> => {
  await pb.collection(COLLECTION).delete(id);
};

export const subscribeVotes = (
  handler: (action: string, record: VoteRecord) => void,
): (() => void) => {
  const pending = pb
    .collection(COLLECTION)
    .subscribe<VoteRecord>('*', (e) => handler(e.action, e.record));
  return () => {
    void pending.then((unsubscribe) => unsubscribe()).catch(() => {});
  };
};
