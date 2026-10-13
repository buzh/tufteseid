

import { pb } from '../api/pocketbase';
import { getUrlParameter, removeUrlParameter } from '../shared/utils/urlUtils';

const arrived = getUrlParameter('invite') ?? '';

export const bootInviteCode = pb.authStore.isValid ? '' : arrived;

export const forgetInviteLink = (): void => {
  if (arrived) removeUrlParameter('invite');
};

if (arrived && !bootInviteCode) forgetInviteLink();

export const inviteUrlOf = (code: string): string =>
  `${window.location.origin}/?invite=${code}`;
