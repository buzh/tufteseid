import { pb } from './pocketbase';

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

export const getRegistrationGate = async (): Promise<RegistrationGate> =>
  await pb
    .collection(GATE)
    .getFirstListItem<RegistrationGate>('', { requestKey: null });
