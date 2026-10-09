// `?invite=<code>` is the whole of an invitation link: no Caddy route, since
// the SPA's own origin already answers `/`.

import { pb } from '../api/pocketbase';
import { getUrlParameter, removeUrlParameter } from '../shared/utils/urlUtils';

const arrived = getUrlParameter('invite') ?? '';

// A code pays for an account being made, so it is no use to a reader who
// already has one — they are following a link to the map like any other.
export const bootInviteCode = pb.authStore.isValid ? '' : arrived;

// Read at import but left on the URL, the way `shareLink.ts` holds `lok`: the
// sign-in box is the only thing that can spend it, and a reload before the
// reader gets there must not lose them their invitation. The box is what
// calls this, on dismissal or on starting the trip.
export const forgetInviteLink = (): void => {
  if (arrived) removeUrlParameter('invite');
};

// Nothing will ever spend it, so it goes now rather than riding along in the
// next link this reader copies — `copyShareLink` falls back to the address
// bar when no spot is open.
if (arrived && !bootInviteCode) forgetInviteLink();

export const inviteUrlOf = (code: string): string =>
  `${window.location.origin}/?invite=${code}`;
