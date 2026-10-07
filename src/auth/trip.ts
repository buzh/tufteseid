// Signing in leaves the page, rather than using PocketBase's popup or framed
// form: those wait for the code over the realtime channel, and the whole view
// is in the URL already, so a trip need only carry the address it left from.
// `completeSignIn` trades the code for a session before React mounts
// (docs/identity.md).

import { pb } from '../api/pocketbase';
import { primeRemarkSession } from '../api/remark42';
import { withDeadline } from '../shared/utils/deadline';

/** Registered in Casdoor, which matches it exactly, and served by a matcher of
 *  its own in `Caddyfile` — there is no SPA fallback to catch it. */
const CALLBACK_PATH = '/auth/callback';

/** Session rather than local storage: the trip belongs to the tab that
 *  started it, and a PKCE verifier outliving the browser is one a later tab
 *  could spend. */
const STASH_KEY = 'tufteseid.signInTrip';

/** One POST to our own PocketBase, which does the token and userinfo calls
 *  over the compose network. Past this the reader is watching a blank page. */
const EXCHANGE_MS = 15_000;

type Trip = {
  provider: string;
  codeVerifier: string;
  state: string;
  returnTo: string;
  /** Empty unless the reader typed one. It has to ride along in the stash:
   *  the gate is enforced where the account is created, which is on the way
   *  back, and by then the box that asked for it is three pages ago. */
  invite: string;
};

const callbackUrl = (): string => `${window.location.origin}${CALLBACK_PATH}`;

/** Casdoor serves the same authorize parameters off a sign-up form of its
 *  own — `web/src/EntryPage.js` in 3.119.0 routes this to its SignupPage. */
const SIGN_IN_PATH = '/login/oauth/authorize';
const SIGN_UP_PATH = '/signup/oauth/authorize';

// Casdoor takes light-versus-dark from `?theme=` alone; the application's own
// theme carries the colours only. Going through `URL` also encodes the
// `redirect_uri` that the SDK's own recipe appends raw.
//
// The path is rewritten only where it is the one being replaced, so a
// provider that is not Casdoor is left where its own authorize URL points.
const authorizeUrl = (url: string, signingUp: boolean): string => {
  const authorize = new URL(url);
  authorize.searchParams.set('theme', 'dark');
  if (signingUp && authorize.pathname === SIGN_IN_PATH) {
    authorize.pathname = SIGN_UP_PATH;
  }
  return authorize.toString();
};

/** Hands the page to the provider's login form, so nothing after it runs.
 *  Rejects only if the authorize URL could not be composed. */
export const startSignIn = async (
  providerName: string,
  invite = '',
): Promise<void> => {
  // Listed again rather than read off `useOAuthProviders`' cache: `state` and
  // the PKCE verifier arrive with the list, and neither is reusable.
  const { oauth2 } = await pb.collection('users').listAuthMethods();
  const provider = oauth2.providers.find((one) => one.name === providerName);
  if (!provider) throw new Error(`unknown auth provider ${providerName}`);

  const trip: Trip = {
    provider: provider.name,
    codeVerifier: provider.codeVerifier,
    state: provider.state,
    returnTo: window.location.href,
    invite,
  };
  sessionStorage.setItem(STASH_KEY, JSON.stringify(trip));

  // `authURL` ends at `redirect_uri=`; the SDK composes it by concatenation
  // and so does this.
  //
  // A reader holding an invite code is making an account by definition, so
  // the login form would cost them a press of "sign up" and a moment
  // wondering whether they already had one.
  window.location.assign(
    authorizeUrl(provider.authURL + callbackUrl(), invite !== ''),
  );
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

/** Why the closed beta turned a first-time reader away, when that is what
 *  happened. Anything else — a bad exchange, a timeout — leaves this null and
 *  shows the generic failure. */
export type SignInRefusal = {
  reason: 'registrationClosed' | 'inviteInvalid';
  /** What the reader typed, so the box can hand it back to be corrected. The
   *  stash it rode in is gone by the time anything can ask. */
  invite: string;
};

let refusal: SignInRefusal | null = null;

/** Whether the trip this page load came back from ended without a session.
 *  Read as the auth atoms are created, which is after `completeSignIn`. */
export const signInReturnFailed = (): boolean => failed;

export const signInReturnRefusal = (): SignInRefusal | null => refusal;

// The gate answers 403 with a `ValidationError` under `invite`, which is the
// only shape PocketBase passes through to the client intact.
const refusalReason = (err: unknown): SignInRefusal['reason'] | null => {
  const code = (err as { response?: { data?: { invite?: { code?: string } } } })
    ?.response?.data?.invite?.code;
  if (code === 'registration_closed') return 'registrationClosed';
  if (code === 'invite_invalid') return 'inviteInvalid';
  return null;
};

/** Puts the address bar back where the reader left it and, if a code came
 *  back with them, trades it for a session. Runs before the app is imported,
 *  so no module that boots off the URL sees the callback. Never rejects. */
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
          undefined,
          trip.invite
            ? { headers: { 'X-Invite-Code': trip.invite } }
            : undefined,
        ),
    );

    // The threads keep a session of their own, bought with a second round
    // trip against the same Casdoor. Here is where that session is newest and
    // the reader is already waiting on a page load, so the trip is spent now
    // rather than in front of the first thread they open — which may be days
    // later, against a Casdoor that has since forgotten them. Not awaited:
    // nothing on the way in is waiting for a comment box.
    void primeRemarkSession();
  } catch (err) {
    console.warn('[auth] code exchange failed', err);
    failed = true;
    const reason = refusalReason(err);
    refusal = reason ? { reason, invite: trip.invite } : null;
  }
};
