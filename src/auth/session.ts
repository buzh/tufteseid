import { pb } from '../api/pocketbase';

export type Refusal = 'registrationClosed' | 'inviteInvalid' | 'queued';

const REFUSALS: Record<string, Refusal> = {
  registration_closed: 'registrationClosed',
  invite_invalid: 'inviteInvalid',
  account_queued: 'queued',
};

export const refusalOf = (err: unknown): Refusal | null => {
  const data =
    (err as { response?: { data?: Record<string, { code?: string }> } })
      ?.response?.data ?? {};
  for (const field of Object.values(data)) {
    const refusal = REFUSALS[field?.code ?? ''];
    if (refusal) return refusal;
  }
  return null;
};

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

export const requestPasswordReset = async (email: string): Promise<void> => {
  await pb.collection('users').requestPasswordReset(email);
};
