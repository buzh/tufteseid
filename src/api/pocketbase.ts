import PocketBase from 'pocketbase';
import { getEnv } from '../env';

// Singleton; LocalAuthStore rehydrates the session on construction. React to
// sign-in/out through pb.authStore.onChange (src/auth/atoms.ts), not by
// importing this into a component.
export const pb = new PocketBase(getEnv().pocketbaseUrl);

export type Role = 'guest' | 'user' | 'admin';

// The users record plus our `role` field, which PB's own type lacks.
export type NkUser = {
  id: string;
  email: string;
  name: string;
  // The stored filename, not a URL — see getUserAvatarUrl.
  avatar: string;
  role: Role;
  created: string;
  updated: string;
  // Present on records off the wire; pb.files.getURL needs one.
  collectionId?: string;
  collectionName?: string;
};

// A PB file field holds a filename, so putting `user.avatar` straight into
// an <img src> asks our own origin for a file that was never there.
export const getUserAvatarUrl = (user: NkUser): string | null => {
  if (!user.avatar) return null;
  return pb.files.getURL(user, user.avatar, { thumb: '100x100' }) || null;
};
