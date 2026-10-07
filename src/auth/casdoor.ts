// Casdoor's own session is what makes one sign-in serve both the app and the
// threads, so signing out has to reach it as well. Left standing it is walked
// straight back into: *Auto signin* sends a reader Casdoor still knows back
// with a code and no form, which is the point of it, and would hand the next
// reader on a shared browser the last one's account (docs/identity.md).

import { pb } from '../api/pocketbase';

/** RP-initiated logout. With no `id_token_hint` Casdoor ends whatever session
 *  the cookie names and answers 200, wanting no registered post-logout URI
 *  and no POST (`controllers/account.go` in 3.119.0). */
const LOGOUT_PATH = '/api/logout';

/** A provider that accepts the connection and never answers would otherwise
 *  hold the whole sign-out open. */
const LOGOUT_BUDGET_MS = 4000;

/** Casdoor's origin, taken off the authorize URL the provider list already
 *  carries. `CASDOOR_HOST` is in `.env` and in `Caddyfile` already, and a
 *  third copy is one that can drift out of step with them. Any provider will
 *  do: every one the app lists is Casdoor, since a second identity provider
 *  is registered there rather than here. */
const casdoorOrigin = async (): Promise<string | null> => {
  const { oauth2 } = await pb.collection('users').listAuthMethods();
  const authUrl = oauth2.providers[0]?.authURL;
  return authUrl ? new URL(authUrl).origin : null;
};

/** Ends the identity provider's session, in a hidden frame — the app's CSP
 *  names Casdoor under `frame-src` and not under `connect-src`, so a fetch is
 *  blocked where a frame is not, and widening `connect-src` for one request
 *  is the worse trade. Never rejects: a sign-out that cannot reach Casdoor
 *  still clears everything on this side. */
export const endCasdoorSession = async (): Promise<void> => {
  let origin: string | null = null;
  try {
    origin = await casdoorOrigin();
  } catch (err) {
    console.warn('[auth] could not find the identity provider', err);
  }
  if (!origin) return;

  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = `${origin}${LOGOUT_PATH}`;

  try {
    document.body.append(frame);
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, LOGOUT_BUDGET_MS);
      frame.addEventListener('load', () => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  } finally {
    frame.remove();
  }
};
