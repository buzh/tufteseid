import { atom } from 'jotai';
import { atomEffect } from 'jotai-effect';
import { NkUser, pb, Role } from '../api/pocketbase';

// Mirrors the PB SDK's authStore, which is the source of truth, so
// components can subscribe through jotai instead of onChange.
export const currentUserAtom = atom<NkUser | null>(
  (pb.authStore.record as NkUser | null) ?? null,
);

// Do not set the user atom directly: go through the SDK's auth calls, whose
// authStore events pbAuthSyncEffect below catches.
export const pbAuthSyncEffect = atomEffect((_get, set) => {
  const unsubscribe = pb.authStore.onChange(() => {
    set(currentUserAtom, (pb.authStore.record as NkUser | null) ?? null);
  });
  return unsubscribe;
});

// Derived so a component does not re-render on unrelated user fields.
export const isSignedInAtom = atom((get) => get(currentUserAtom) != null);

export const roleAtom = atom<Role>((get) => {
  const u = get(currentUserAtom);
  if (!u) return 'guest';
  return u.role ?? 'user';
});

export const isAdminAtom = atom((get) => get(roleAtom) === 'admin');
