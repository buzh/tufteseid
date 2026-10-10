// Signing in is one POST against our own PocketBase and nothing leaves the
// page: there is no identity provider and no redirect to come back from
// (docs/identity.md).

import { pb } from '../api/pocketbase';

/** Why the closed beta turned a would-be reader away. Anything else shows as
 *  the generic failure. */
export type Refusal = 'registrationClosed' | 'inviteInvalid';

// The gate answers 403 with a `ValidationError` under `invite`, which is the
// only shape PocketBase passes through to the client intact.
export const refusalOf = (err: unknown): Refusal | null => {
  const code = (err as { response?: { data?: { invite?: { code?: string } } } })
    ?.response?.data?.invite?.code;
  if (code === 'registration_closed') return 'registrationClosed';
  if (code === 'invite_invalid') return 'inviteInvalid';
  return null;
};

/** Which fields PocketBase refused, so a 400 can say which one. */
export const badFields = (err: unknown): string[] =>
  Object.keys(
    (err as { response?: { data?: Record<string, unknown> } })?.response
      ?.data ?? {},
  );

export const signIn = async (
  email: string,
  password: string,
): Promise<void> => {
  await pb.collection('users').authWithPassword(email, password);
};

/**
 * Makes the account and signs in with it.
 *
 * The invite code rides on a header rather than in the body, because it pays
 * for the row rather than belonging to it: `pb_hooks/closed_beta.pb.js` reads
 * it and refuses the create outright, so a refusal leaves nothing behind
 * (`docs/closed-beta.md`). What the reader may *be* is not sent at all —
 * `pb_hooks/identity.pb.js` pins `role` and the rest, the create rule being
 * open to a guest and unable to name a field.
 */
export const register = async ({
  email,
  password,
  name,
  invite,
}: {
  email: string;
  password: string;
  name: string;
  invite: string;
}): Promise<void> => {
  await pb
    .collection('users')
    .create(
      { email, password, passwordConfirm: password, name },
      invite ? { headers: { 'X-Invite-Code': invite } } : undefined,
    );
  await signIn(email, password);
};

/** Posts the reset letter. Answers 204 whether or not the address is one we
 *  know, so nothing here can be used to ask whether somebody has an account. */
export const requestPasswordReset = async (email: string): Promise<void> => {
  await pb.collection('users').requestPasswordReset(email);
};
