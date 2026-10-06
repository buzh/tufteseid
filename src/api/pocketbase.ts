import PocketBase from 'pocketbase';

import { getEnv } from '../env';

// LocalAuthStore rehydrates from localStorage on construction, so the first
// request of a cold load already carries any stored token.
export const pb = new PocketBase(getEnv().pocketbaseUrl);

export type Role = 'guest' | 'user' | 'admin';

// `role` is absent on an OAuth auto-provisioned account; missing reads as
// 'user'.
export type SiteUser = {
  id: string;
  email: string;
  name: string;
  role?: Role;
  /** How many invites this account may ever mint, granted by hand. What is
   *  left to mint is this less the rows it has issued. */
  inviteQuota?: number;
  created: string;
  updated: string;
};
