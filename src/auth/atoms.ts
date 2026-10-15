import { atom } from 'jotai';
import { atomEffect } from 'jotai-effect';

import { pb, Role, SiteUser } from '../api/pocketbase';
import { bootInviteCode } from '../invites/inviteLink';
import { syncNibCookie } from './nibCookie';

export const currentUserAtom = atom<SiteUser | null>(
  (pb.authStore.record as SiteUser | null) ?? null,
);

export const pbAuthSyncEffect = atomEffect((_get, set) => {
  const unsubscribe = pb.authStore.onChange(() => {
    set(currentUserAtom, (pb.authStore.record as SiteUser | null) ?? null);
    syncNibCookie();
  });

  syncNibCookie();

  if (!pb.authStore.isValid) {
    pb.authStore.clear();
  } else {
    void pb
      .collection('users')
      .authRefresh()
      .catch((err: unknown) => {
        const status = (err as { status?: number })?.status;
        if (status === 401 || status === 403) pb.authStore.clear();
      });
  }

  return unsubscribe;
});

export const isSignedInAtom = atom((get) => get(currentUserAtom) != null);

const roleAtom = atom<Role>((get) => {
  const user = get(currentUserAtom);
  if (!user) return 'guest';
  return user.role ?? 'user';
});

export const isAdminAtom = atom((get) => get(roleAtom) === 'admin');

export const isAuthDialogOpenAtom = atom(bootInviteCode !== '');

export const isProfileDialogOpenAtom = atom(false);

export type AuthPrompt = 'spotLink' | 'inviteLink';

export const authPromptAtom = atom<AuthPrompt | null>(
  bootInviteCode ? 'inviteLink' : null,
);
