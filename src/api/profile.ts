// The reader's own `users` row, and the two credentials that are not part of
// it (`docs/identity.md`).

import { pb, type SiteUser } from './pocketbase';

const COLLECTION = 'users';

/** The three fields `1700002900_user_profile.js` opened the update rule for.
 *  `avatar` undefined leaves the stored picture alone, null drops it. */
export type ProfileEdit = {
  name: string;
  description: string;
  avatar?: File | null;
};

/** Everything else on the row is put back by `pb_hooks/identity.pb.js`, so
 *  this sends only what it may. The SDK writes the answer into `authStore`
 *  itself, which `pbAuthSyncEffect` mirrors onwards. */
export const saveProfile = async (
  id: string,
  { name, description, avatar }: ProfileEdit,
): Promise<SiteUser> =>
  await pb.collection(COLLECTION).update<SiteUser>(id, {
    name,
    description,
    ...(avatar === undefined ? {} : { avatar }),
  });

/** Moves the address with no confirmation letter, which is what it costs the
 *  current password (`pb_hooks/profile.pb.js`). The token survives it, but
 *  the record behind it is stale until something re-reads the row. */
export const changeEmail = async (
  email: string,
  password: string,
): Promise<void> => {
  await pb.send('/api/profile/email', {
    method: 'POST',
    body: { email, password },
    requestKey: null,
  });
  await pb.collection(COLLECTION).authRefresh();
};

/**
 * Answers false when the password moved but signing back in did not land.
 *
 * PocketBase refreshes the record's token key on a password change, so the
 * token in hand dies with the old password whatever happens next and the
 * session has to be made again. A failure there leaves the reader signed out
 * with their new password working — the sign-in box, not an error.
 */
export const changePassword = async ({
  id,
  email,
  oldPassword,
  password,
}: {
  id: string;
  email: string;
  oldPassword: string;
  password: string;
}): Promise<boolean> => {
  await pb
    .collection(COLLECTION)
    .update(id, { oldPassword, password, passwordConfirm: password });

  try {
    await pb.collection(COLLECTION).authWithPassword(email, password);
    return true;
  } catch (err) {
    console.warn('[profile] signing back in failed', err);
    pb.authStore.clear();
    return false;
  }
};
