import PocketBase from 'pocketbase';

import { getEnv } from '../env';

// LocalAuthStore rehydrates from localStorage on construction, so the first
// request of a cold load already carries any stored token.
export const pb = new PocketBase(getEnv().pocketbaseUrl);

/** `queued` is an account the user cap would not seat, which is refused at
 *  sign-in, so it never reaches `currentUserAtom` (`docs/identity.md`). */
export type Role = 'guest' | 'user' | 'admin' | 'queued';

// `role` is optional on the collection, so missing reads as 'user'.
export type SiteUser = {
  id: string;
  /** What `pb.files.getURL` reads to build the path to `avatar`. */
  collectionId: string;
  email: string;
  name: string;
  /** The stored filename, '' for none. Only the reader themselves can see it:
   *  `users` is closed to everybody else, which is also why `spots.credit` is
   *  denormalized (`docs/identity.md`). */
  avatar?: string;
  /** The reader's own line about themselves, ≤120 characters. */
  description?: string;
  role?: Role;
  /** What this account may spend, granted by hand (`docs/identity.md`). Read
   *  it through `useHasFeature` (`src/auth/features.ts`), never directly — an
   *  admin holds every feature and this list does not say so. */
  features?: string[];
  /** How many invites this account may ever mint, granted by hand. What is
   *  left to mint is this less the rows it has issued. */
  inviteQuota?: number;
  created: string;
  updated: string;
};
