import { atom } from 'jotai';
import { atomEffect } from 'jotai-effect';

import { pb, Role, SiteUser } from '../api/pocketbase';

// Mirrors the PB SDK's authStore, which is the source of truth, so components
// can subscribe through jotai instead of through onChange. Seeded rather than
// left null: the store rehydrates from localStorage when the module is
// imported, so a returning reader is already signed in at first paint.
export const currentUserAtom = atom<SiteUser | null>(
  (pb.authStore.record as SiteUser | null) ?? null,
);

// Do not set the user atom directly — go through the SDK's auth calls, whose
// authStore events this effect catches.
export const pbAuthSyncEffect = atomEffect((_get, set) => {
  const unsubscribe = pb.authStore.onChange(() => {
    set(currentUserAtom, (pb.authStore.record as SiteUser | null) ?? null);
  });
  return unsubscribe;
});

// Derived so a component does not re-render on an unrelated user field.
export const isSignedInAtom = atom((get) => get(currentUserAtom) != null);

// Not exported: `isAdminAtom` is the only question anything asks, and a second
// way to ask it is a second thing to keep in step with the server's rules.
const roleAtom = atom<Role>((get) => {
  const user = get(currentUserAtom);
  if (!user) return 'guest';
  return user.role ?? 'user';
});

export const isAdminAtom = atom((get) => get(roleAtom) === 'admin');

// Its own atom rather than a field on a surface's state: the dialog is mounted
// once at the top of the app and opened from several places — the sign-in
// button, and any verb that turns out to need an account.
export const isAuthDialogOpenAtom = atom(false);

/**
 * Why the dialog is up, when the reader did not ask for it. Null for the button
 * in the band, which needs no explanation; `spotLink` for a followed link that
 * resolved to nothing a guest may see, where a modal with no reason on it is
 * the app appearing to demand an account out of nowhere.
 */
export type AuthPrompt = 'spotLink';

export const authPromptAtom = atom<AuthPrompt | null>(null);
