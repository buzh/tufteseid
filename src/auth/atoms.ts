import { atom } from 'jotai';
import { atomEffect } from 'jotai-effect';

import { pb, Role, SiteUser } from '../api/pocketbase';

// Mirrors the SDK's authStore, which stays the source of truth. Do not set
// this directly — go through the SDK's auth calls, which `pbAuthSyncEffect`
// listens to.
export const currentUserAtom = atom<SiteUser | null>(
  (pb.authStore.record as SiteUser | null) ?? null,
);

export const pbAuthSyncEffect = atomEffect((_get, set) => {
  const unsubscribe = pb.authStore.onChange(() => {
    set(currentUserAtom, (pb.authStore.record as SiteUser | null) ?? null);
  });

  // A rehydrated token the server has stopped honouring still looks valid here.
  if (!pb.authStore.isValid) {
    pb.authStore.clear();
  } else {
    void pb
      .collection('users')
      .authRefresh()
      .catch((err: unknown) => {
        // Only a refusal signs the reader out; a cold load with no network
        // is not evidence the session is gone.
        const status = (err as { status?: number })?.status;
        if (status === 401 || status === 403) pb.authStore.clear();
      });
  }

  return unsubscribe;
});

// Derived so a component does not re-render on an unrelated user field.
export const isSignedInAtom = atom((get) => get(currentUserAtom) != null);

const roleAtom = atom<Role>((get) => {
  const user = get(currentUserAtom);
  if (!user) return 'guest';
  return user.role ?? 'user';
});

export const isAdminAtom = atom((get) => get(roleAtom) === 'admin');

export const isAuthDialogOpenAtom = atom(false);

/** Why the dialog is up when the reader did not ask for it; null for the
 *  sign-in button itself. */
export type AuthPrompt = 'spotLink';

export const authPromptAtom = atom<AuthPrompt | null>(null);
