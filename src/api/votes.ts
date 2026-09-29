import { pb } from './pocketbase';

const COLLECTION = 'votes';
const SCORES = 'spotScores';

/** Must match the `direction` select in `1700001700_spot_votes.js`. */
export type VoteDirection = 'up' | 'down';

export type VoteRecord = {
  id: string;
  owner: string;
  spot: string;
  direction: VoteDirection;
  created: string;
  updated: string;
};

/** A row of the `spotScores` view. A spot nobody has voted on has no row at
 *  all rather than a row of zeroes. */
export type SpotScore = {
  /** The view's id *is* the spot id — it groups by `spot`. */
  id: string;
  spot: string;
  votes: number;
  up: number;
  down: number;
  score: number;
};

// PocketBase reports a unique-index violation as a 400 with a per-field entry.
// Here it means this reader has already voted on this spot.
const isAlreadyVoted = (err: unknown): boolean =>
  (err as { response?: { data?: Record<string, { code?: string }> } })?.response
    ?.data?.owner?.code === 'validation_not_unique';

/** The reader's own votes. Empty when signed out. Filtered here rather than
 *  left to the list rule: that rule also lets an admin list everybody's, and
 *  another reader's row keyed under a spot reads as a vote this account cast
 *  — and retracting it would delete theirs. */
export const listMyVotes = async (): Promise<VoteRecord[]> => {
  const owner = pb.authStore.record?.id;
  return owner
    ? await pb.collection(COLLECTION).getFullList<VoteRecord>({
        filter: pb.filter('owner = {:owner}', { owner }),
      })
    : [];
};

/** Every spot that has been voted on, best first. Open to a guest. */
export const listSpotScores = async (): Promise<SpotScore[]> =>
  await pb.collection(SCORES).getFullList<SpotScore>({ sort: '-score' });

/** Null when the spot has no votes yet. */
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

/** Cast or change a vote. Creating is the common case, so it goes first and
 *  the unique-index 400 is what says the reader has voted here before. */
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
