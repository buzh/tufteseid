// `?invite=<code>` is the whole of an invitation link: no Caddy route, since
// the SPA's own origin already answers `/`.

import { getUrlParameter, removeUrlParameter } from '../shared/utils/urlUtils';

// Read and cleared at import, the way `shareLink.ts` takes `lok`: the code
// belongs to the visit that arrived carrying it, not to whatever the reader
// copies out of the address bar afterwards.
const take = (): string => {
  const code = getUrlParameter('invite') ?? '';
  if (code) removeUrlParameter('invite');
  return code;
};

export const bootInviteCode = take();

export const inviteUrlOf = (code: string): string =>
  `${window.location.origin}/?invite=${code}`;
