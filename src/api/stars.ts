import { pb } from './pocketbase';

const COLLECTION = 'stars';
const COUNTS = 'starCounts';

export type StarRecord = {
  id: string;
  owner: string;
  spot: string;
  created: string;
};

export type StarCount = {

  id: string;
  spot: string;
  stars: number;
};

const isAlreadyStarred = (err: unknown): boolean =>
  (err as { response?: { data?: Record<string, { code?: string }> } })?.response
    ?.data?.owner?.code === 'validation_not_unique';

export const listMyStars = async (): Promise<StarRecord[]> => {
  const owner = pb.authStore.record?.id;
  return owner
    ? await pb.collection(COLLECTION).getFullList<StarRecord>({
        filter: pb.filter('owner = {:owner}', { owner }),
        sort: '-created',
      })
    : [];
};

export const listStarCounts = async (): Promise<StarCount[]> =>
  await pb.collection(COUNTS).getFullList<StarCount>({ sort: '-stars' });

export const getStarCount = async (
  spotId: string,
): Promise<StarCount | null> => {
  try {
    return await pb
      .collection(COUNTS)
      .getOne<StarCount>(spotId, { requestKey: null });
  } catch {
    return null;
  }
};

export const addStar = async (
  spotId: string,
  ownerId: string,
): Promise<StarRecord> => {
  try {
    return await pb
      .collection(COLLECTION)
      .create<StarRecord>({ owner: ownerId, spot: spotId });
  } catch (err) {
    if (!isAlreadyStarred(err)) throw err;
    return await pb.collection(COLLECTION).getFirstListItem<StarRecord>(
      pb.filter('owner = {:owner} && spot = {:spot}', {
        owner: ownerId,
        spot: spotId,
      }),
      { requestKey: null },
    );
  }
};

export const removeStar = async (id: string): Promise<void> => {
  await pb.collection(COLLECTION).delete(id);
};

export const subscribeStars = (
  handler: (action: string, record: StarRecord) => void,
): (() => void) => {
  const pending = pb
    .collection(COLLECTION)
    .subscribe<StarRecord>('*', (e) => handler(e.action, e.record));
  return () => {
    void pending.then((unsubscribe) => unsubscribe()).catch(() => {});
  };
};
