import { pb } from './pocketbase';

const COLLECTION = 'invites';
const GATE = 'registration';

/** The one row of `registration`, open to a guest so the sign-in box can say
 *  how many places are left before the reader leaves for the provider.
 *  `closed` false means anybody may register and the rest is moot. */
export type RegistrationGate = {
  id: string;
  openSlots: number;
  closed: boolean;
  created: string;
  updated: string;
};

/** Must match `1700002000_closed_beta.js`. `code` and the two redemption
 *  fields are the hook's to write — the client only ever sends `issuer`. */
export type InviteRecord = {
  id: string;
  code: string;
  issuer: string;
  /** Empties if the invitee closes their account, so `redeemedAt` rather than
   *  this is what says an invite is spent. */
  redeemedBy: string;
  redeemedAt: string;
  email: string;
  sentAt: string;
  created: string;
  updated: string;
};

/** Null on an installation whose single row is missing, which reads as no
 *  gate at all. Listed rather than filtered: there is only ever one row, and
 *  an empty `filter=` is not worth relying on. */
export const getRegistrationGate =
  async (): Promise<RegistrationGate | null> => {
    const { items } = await pb
      .collection(GATE)
      .getList<RegistrationGate>(1, 1, { requestKey: null });
    return items[0] ?? null;
  };

/** The reader's own invites. Empty when signed out. */
export const listMyInvites = async (): Promise<InviteRecord[]> => {
  const issuer = pb.authStore.record?.id;
  return issuer
    ? await pb.collection(COLLECTION).getFullList<InviteRecord>({
        filter: pb.filter('issuer = {:issuer}', { issuer }),
        sort: '-created',
      })
    : [];
};

/** Mints one. The hook refuses with 403 once the quota is used up, and the
 *  code comes back on the record. */
export const createInvite = async (issuer: string): Promise<InviteRecord> =>
  await pb.collection(COLLECTION).create<InviteRecord>({ issuer });

/** Gives the quota back. The delete rule allows it only while unspent. */
export const revokeInvite = async (id: string): Promise<void> => {
  await pb.collection(COLLECTION).delete(id);
};

/** One mail per invite, so this answers 400 on a second try. A route of its
 *  own because the reader may set the address and nothing else. */
export const sendInvite = async (id: string, email: string): Promise<void> => {
  await pb.send(`/api/invites/${id}/send`, {
    method: 'POST',
    body: { email },
    requestKey: null,
  });
};
