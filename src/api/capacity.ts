import { pb } from './pocketbase';

/** How full the installation is, from `pb_hooks/capacity.pb.js`. `max` is
 *  `MAXUSERS` as the backend read it, and 0 means no cap — on which the
 *  surfaces say nothing (`docs/identity.md`). */
export type Capacity = { users: number; max: number };

/** Open to a guest: the sign-in box asks before it offers to make an
 *  account. A route of its own because `users` is closed and a guest cannot
 *  count a collection they may not list. */
export const getCapacity = async (): Promise<Capacity> =>
  await pb.send<Capacity>('/api/capacity', {
    method: 'GET',
    requestKey: null,
  });
