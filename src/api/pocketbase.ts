import PocketBase from 'pocketbase';

import { getEnv } from '../env';

// LocalAuthStore rehydrates the session on construction, so the first request
// of a cold load already carries whatever token localStorage held.
export const pb = new PocketBase(getEnv().pocketbaseUrl);

export type Role = 'guest' | 'user' | 'admin';

// `role` is optional: PocketBase populates only its own fields when it
// auto-provisions an OAuth signup, so a missing one reads as 'user'.
export type SiteUser = {
  id: string;
  email: string;
  name: string;
  role?: Role;
  created: string;
  updated: string;
};
