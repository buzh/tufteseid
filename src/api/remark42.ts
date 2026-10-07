// Remark42 keeps a session of its own, federated to the same Casdoor the app
// signs in through. `primeRemarkSession` runs that OAuth2 round trip in a
// hidden frame so the reader is not asked to press a second sign-in button —
// on the way back from signing in, and again in front of the first thread of
// a page that did not. Every way it can fail lands back on the widget's own
// button, which `SpotTalk` says out loud (docs/discussion-and-votes.md).

/** Caddy strips the prefix; remark42 itself serves at the root. */
const BASE = '/remark42';

/** `AUTH_CUSTOM_NAME` in `docker-compose.yml`, and the last segment of the
 *  redirect URI registered in Casdoor. The three move together. */
const PROVIDER = 'tufteseid';

/** `SITE` in `docker-compose.yml`. */
export const REMARK_SITE = 'tufteseid';

/** Where the trip parks the frame when it is done. On our own origin, so the
 *  pathname is readable from outside; nothing reads the document. */
const LANDING = '/favicon.svg';

/** Two redirects and Casdoor's bundle on a cold cache. Past this the reader
 *  is watching a spinner for a thread that would have rendered. */
const TRIP_BUDGET_MS = 8000;

/** What the widget is pointed at. */
export const remarkHost = (): string => `${window.location.origin}${BASE}`;

/** True once remark42 knows who the reader is. */
export const hasRemarkSession = async (): Promise<boolean> => {
  try {
    return (await fetch(`${BASE}/api/v1/user?site=${REMARK_SITE}`)).ok;
  } catch {
    return false;
  }
};

/** Resolves on the first of: the frame back on our own origin, Casdoor saying
 *  it has nobody to sign in, or the budget running out. Never rejects; the
 *  caller asks remark42 afterwards rather than trusting any of the three. */
const waitForTrip = (frame: HTMLIFrameElement): Promise<void> =>
  new Promise((resolve) => {
    const timer = window.setTimeout(done, TRIP_BUDGET_MS);

    function done() {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.removeEventListener('load', onLoad);
      resolve();
    }

    // Origin unchecked because Casdoor's is not known on this side. The worst
    // a forged message can do is end the trip early, which is the fallback.
    function onMessage(event: MessageEvent) {
      const message = event.data as { tag?: string; data?: string } | null;
      if (message?.tag === 'Casdoor' && message.data === 'user-not-logged-in') {
        done();
      }
    }

    function onLoad() {
      try {
        if (frame.contentWindow?.location.pathname === LANDING) done();
      } catch {
        // Mid-trip on Casdoor's origin: not readable, and not the end of it.
      }
    }

    window.addEventListener('message', onMessage);
    frame.addEventListener('load', onLoad);
  });

let priming: Promise<boolean> | null = null;

const runPrime = async (): Promise<boolean> => {
  if (await hasRemarkSession()) return true;

  const from = encodeURIComponent(`${window.location.origin}${LANDING}`);
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = `${BASE}/auth/${PROVIDER}/login?site=${REMARK_SITE}&from=${from}`;

  try {
    document.body.append(frame);
    await waitForTrip(frame);
  } finally {
    frame.remove();
  }

  return await hasRemarkSession();
};

/** Once per page: a reader with no Casdoor session will not grow one by being
 *  asked twice. */
export const primeRemarkSession = (): Promise<boolean> => {
  priming ??= runPrime().catch(() => false);
  return priming;
};

/** Signing out is the only thing that changes the answer within one page —
 *  signing in is a redirect, and the page that comes back has never asked. */
const resetRemarkSession = (): void => {
  priming = null;
};

/** A sidecar that accepts the connection and never answers would otherwise
 *  hold the whole sign-out open. */
const LOGOUT_BUDGET_MS = 3000;

/** Signs out of the threads. The Casdoor session behind both sides is ended
 *  alongside this one, by `src/auth/casdoor.ts`. */
export const endRemarkSession = async (): Promise<void> => {
  resetRemarkSession();
  try {
    await fetch(`${BASE}/auth/logout?site=${REMARK_SITE}`, {
      signal: AbortSignal.timeout(LOGOUT_BUDGET_MS),
    });
  } catch {
    // A sidecar that cannot be reached is not holding a session open either.
  }
};
