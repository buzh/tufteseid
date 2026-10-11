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
  email: string;
  name: string;
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
