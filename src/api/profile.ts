import { pb, type SiteUser } from './pocketbase';

const COLLECTION = 'users';

export type ProfileEdit = {
  name: string;
  description: string;
  avatar?: File | null;
};

export const saveProfile = async (
  id: string,
  { name, description, avatar }: ProfileEdit,
): Promise<SiteUser> =>
  await pb.collection(COLLECTION).update<SiteUser>(id, {
    name,
    description,
    ...(avatar === undefined ? {} : { avatar }),
  });

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
