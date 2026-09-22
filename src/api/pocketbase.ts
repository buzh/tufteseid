import PocketBase from 'pocketbase';

import { getEnv } from '../env';

// Singleton; LocalAuthStore rehydrates the session on construction, so the
// first request of a cold load already carries whatever token localStorage
// held. React to sign-in/out through pb.authStore.onChange (src/auth/atoms.ts)
// rather than by importing this into a component.
export const pb = new PocketBase(getEnv().pocketbaseUrl);

export type Role = 'guest' | 'user' | 'admin';

// The users record plus our own `role` field, which PB's type lacks. `role` is
// optional on the server — PocketBase populates only its known fields when it
// auto-provisions an OAuth signup — so a missing one reads as 'user'.
export type SiteUser = {
  id: string;
  email: string;
  name: string;
  role?: Role;
  created: string;
  updated: string;
};
