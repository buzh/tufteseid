import { pb } from './pocketbase';

const COLLECTION = 'invites';
const GATE = 'registration';

export type RegistrationGate = {
  id: string;
  openSlots: number;
  closed: boolean;
  created: string;
  updated: string;
};

export type InviteRecord = {
  id: string;
  code: string;
  issuer: string;

  redeemedBy: string;
  redeemedAt: string;
  email: string;
  sentAt: string;
  created: string;
  updated: string;
};

export const getRegistrationGate =
  async (): Promise<RegistrationGate | null> => {
    const { items } = await pb
      .collection(GATE)
      .getList<RegistrationGate>(1, 1, { requestKey: null });
    return items[0] ?? null;
  };

export const listMyInvites = async (): Promise<InviteRecord[]> => {
  const issuer = pb.authStore.record?.id;
  return issuer
    ? await pb.collection(COLLECTION).getFullList<InviteRecord>({
        filter: pb.filter('issuer = {:issuer}', { issuer }),
        sort: '-created',
      })
    : [];
};

export const createInvite = async (issuer: string): Promise<InviteRecord> =>
  await pb.collection(COLLECTION).create<InviteRecord>({ issuer });

export const revokeInvite = async (id: string): Promise<void> => {
  await pb.collection(COLLECTION).delete(id);
};

export const sendInvite = async (id: string, email: string): Promise<void> => {
  await pb.send(`/api/invites/${id}/send`, {
    method: 'POST',
    body: { email },
    requestKey: null,
  });
};
