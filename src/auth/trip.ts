// Signing in leaves the page. PocketBase offers two ways to keep the browser
// here — a popup and a framed form, both fed by a code that comes back over
// its realtime channel — and this app uses neither: the whole view is in the
// URL already, so the only thing a trip has to carry is the address it left
// from, and nothing then rests on a long-lived stream staying open while
// somebody fills in a form.
//
// What comes back instead is an authorization code on the query string, which
// `completeSignIn` trades for a session before React mounts. Casdoor's login
// page is a page rather than a frame here, which is the one state in which it
// styles itself (docs/identity.md).

import { pb } from '../api/pocketbase';
import { withDeadline } from '../shared/utils/deadline';

/** Registered in Casdoor, which matches it exactly, and served by a matcher of
 *  its own in `Caddyfile` — there is no SPA fallback to catch it. */
const CALLBACK_PATH = '/auth/callback';

/** Session rather than local storage: the trip belongs to the tab that
 *  started it, and a PKCE verifier outliving the browser is one a later tab
 *  could spend. */
const STASH_KEY = 'tufteseid.signInTrip';

/** One POST to our own PocketBase, which does the token exchange and the
 *  userinfo fetch over the compose network. Past this the reader is watching a
 *  blank page for a session that is not coming, and their own page with a
 *  retry on it is the better place to wait. */
const EXCHANGE_MS = 15_000;

type Trip = {
  provider: string;
  codeVerifier: string;
  state: string;
  returnTo: string;
};

const callbackUrl = (): string => `${window.location.origin}${CALLBACK_PATH}`;

// Casdoor picks its light or dark algorithm from `?theme=`, falling back to
// whatever the last visit left in that origin's localStorage and then to
// light. The application's own theme carries the colours only, so without this
// the reader lands on a white form with a papaya button in it. Going through
// `URL` also encodes the `redirect_uri` that the SDK's own recipe appends
// raw.
const darkened = (url: string): string => {
  const themed = new URL(url);
  themed.searchParams.set('theme', 'dark');
  return themed.toString();
};

/** Hands the page to the provider's login form, so nothing after it runs.
 *  Rejects only if the authorize URL could not be composed. */
export const startSignIn = async (providerName: string): Promise<void> => {
  // Listed again rather than read off `useOAuthProviders`' cache: `state` and
  // the PKCE verifier arrive with the list, and a pair already spent on one
  // trip cannot pay for a second.
  const { oauth2 } = await pb.collection('users').listAuthMethods();
  const provider = oauth2.providers.find((one) => one.name === providerName);
  if (!provider) throw new Error(`unknown auth provider ${providerName}`);

  const trip: Trip = {
    provider: provider.name,
    codeVerifier: provider.codeVerifier,
    state: provider.state,
    returnTo: window.location.href,
  };
  sessionStorage.setItem(STASH_KEY, JSON.stringify(trip));

  // `authURL` ends at `redirect_uri=`; the SDK composes it by concatenation
  // and so does this.
  window.location.assign(darkened(provider.authURL + callbackUrl()));
};

export const isSignInReturn = (): boolean =>
  window.location.pathname === CALLBACK_PATH;

const takeTrip = (): Trip | null => {
  const raw = sessionStorage.getItem(STASH_KEY);
  sessionStorage.removeItem(STASH_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Trip;
  } catch {
    return null;
  }
};

let failed = false;

/** Whether the trip this page load came back from ended without a session.
 *  Read as the auth atoms are created, which is after `completeSignIn`. */
export const signInReturnFailed = (): boolean => failed;

/** Puts the address bar back where the reader left it and, if a code came back
 *  with them, trades it for a session — both before the app is imported, so no
 *  module that boots off the URL or off the auth store has to know a trip
 *  happened. Never rejects. */
export const completeSignIn = async (): Promise<void> => {
  const { searchParams } = new URL(window.location.href);
  const trip = takeTrip();

  window.history.replaceState({}, '', trip?.returnTo ?? '/');

  // Nobody started a trip from this tab: a cold visit to the callback, or a
  // session storage the browser emptied under it. Nothing failed.
  if (!trip) return;

  const code = searchParams.get('code');
  // Casdoor sends `error` rather than `code` when the reader backs out, and
  // `state` is the only thing tying a code to the trip that asked for it.
  if (!code || searchParams.get('state') !== trip.state) {
    failed = true;
    return;
  }

  try {
    await withDeadline(EXCHANGE_MS, 'oauth2 code exchange', () =>
      pb
        .collection('users')
        .authWithOAuth2Code(
          trip.provider,
          code,
          trip.codeVerifier,
          callbackUrl(),
        ),
    );
  } catch (err) {
    console.warn('[auth] code exchange failed', err);
    failed = true;
  }
};
