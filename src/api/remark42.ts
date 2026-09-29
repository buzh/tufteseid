// Remark42 keeps a session of its own. It federates to the same Casdoor the
// app signs in through, so the reader needs no second credential — but the
// OAuth2 round trip still has to happen, and left to the widget it is a button
// the reader has to find and press before they can say anything.
//
// `primeRemarkSession` runs that trip in a hidden iframe instead. What makes
// it invisible is `silentSignin` on remark42's authorize URL
// (`docker-compose.yml`): without it Casdoor draws a "Continue with …" panel
// even for a reader it already knows, and a hidden frame is the one place
// nobody can press it.
//
// Every way this can fail ends at the widget's own provider button, which is
// what the reader had before: a Casdoor session that has expired while the
// app's token has not, a Casdoor on a registrable domain of its own so the
// frame's cookies count as third-party, a browser that refuses the frame.

/** Caddy strips the prefix; remark42 itself serves at the root. */
const BASE = '/remark42';

/** `AUTH_CUSTOM_NAME` in `docker-compose.yml`, which is also the last segment
 *  of the redirect URI registered in Casdoor. The three move together. */
const PROVIDER = 'tufteseid';

/** `SITE` in `docker-compose.yml`. */
export const REMARK_SITE = 'tufteseid';

/** Where the round trip parks the frame when it is done. On our own origin,
 *  so `frame-ancestors 'self'` allows it and the pathname can be read from
 *  outside; nothing reads the document itself. */
const LANDING = '/favicon.svg';

/** Two redirects and Casdoor's own bundle on a cold cache, and no longer:
 *  past this the reader is watching a spinner for a thread that would have
 *  rendered. */
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
 *  it has nobody to sign in, or the budget running out. Never rejects — the
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

    // Casdoor posts this from inside the frame, and only from inside one. The
    // origin goes unchecked because it is not known on this side; the worst a
    // forged message can do is end the trip early, which is the fallback the
    // reader would have had anyway.
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

/** Once per page: the trip is an identity-provider round trip, and a reader
 *  who has no Casdoor session will not grow one by being asked twice. */
export const primeRemarkSession = (): Promise<boolean> => {
  priming ??= runPrime().catch(() => false);
  return priming;
};

/** Forgets the answer above, so the next thread asks again. Signing in is the
 *  reason to: the page may already have concluded there was nobody to sign
 *  in. */
export const resetRemarkSession = (): void => {
  priming = null;
};

/** Signs out of the threads. The Casdoor session behind both sides is left
 *  alone — it is what makes the next sign-in a single click, and ending it is
 *  Casdoor's own business, on Casdoor's own hostname. */
export const endRemarkSession = async (): Promise<void> => {
  resetRemarkSession();
  try {
    await fetch(`${BASE}/auth/logout?site=${REMARK_SITE}`);
  } catch {
    // A sidecar that cannot be reached is not holding a session open either.
  }
};
