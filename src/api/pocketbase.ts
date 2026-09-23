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
  created: string;
  updated: string;
};
