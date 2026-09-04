import PocketBase from 'pocketbase';
import { getEnv } from '../env';

// Singleton PB client. The SDK's LocalAuthStore rehydrates the session
// from localStorage on construction, so importing this module anywhere
// gets you the current auth state.
//
// If you need to react to sign-in/out, subscribe to pb.authStore.onChange
// (see src/auth/atoms.ts) rather than importing this in a component.
export const pb = new PocketBase(getEnv().pocketbaseUrl);

export type Role = 'guest' | 'user' | 'admin';

// Shape of a users record with our added `role` field. PB's default
// UsersRecord type doesn't know about the extension.
export type NkUser = {
  id: string;
  email: string;
  name: string;
  // The stored *filename*, not a URL — see getUserAvatarUrl.
  avatar: string;
  role: Role;
  created: string;
  updated: string;
  // Present on records that came off the wire; pb.files.getURL needs one.
  collectionId?: string;
  collectionName?: string;
};

// A PB file field holds a filename. Rendering `user.avatar` straight into
// an <img src> therefore asks the SPA's own origin for a file that was
// never there — a 404 per sign-in, visible only in the console. The OAuth
// providers give us one, so this fires for most signed-in users.
//
// Unlike attachments, the stock `users.avatar` field is not protected, so
// no file token is needed here.
export const getUserAvatarUrl = (user: NkUser): string | null => {
  if (!user.avatar) return null;
  return pb.files.getURL(user, user.avatar, { thumb: '100x100' }) || null;
};
