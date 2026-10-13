import { pb } from './pocketbase';

export type Capacity = { users: number; max: number };

export const getCapacity = async (): Promise<Capacity> =>
  await pb.send<Capacity>('/api/capacity', {
    method: 'GET',
    requestKey: null,
  });
