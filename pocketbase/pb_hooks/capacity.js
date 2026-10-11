/// <reference path="../pb_data/types.d.ts" />
//
// How many accounts this installation holds places for, and the `queued`
// role that is what being over it looks like (`docs/identity.md`).
//
// Not named `*.pb.js`: that suffix is what PocketBase loads as hooks, and a
// handler cannot see the scope of the file it is written in — `closed_beta.js`
// has the whole of why.

const QUEUED = 'queued';
const MEMBER = 'user';

/** `MAXUSERS` from the environment, which compose passes through from `.env`.
 *  0 is no cap, and so is unset, blank, unparseable or negative: a cap has to
 *  be asked for, and there is no reading of a bad value that should lock
 *  everybody out. */
const maxUsers = () => {
  const asked = parseInt($os.getenv('MAXUSERS') || '', 10);
  return Number.isFinite(asked) && asked > 0 ? asked : 0;
};

/** Accounts holding a place. A queued row is an account that exists and holds
 *  none — counting it would have the queue fill the very places it waits for.
 *  COALESCE because `role` is optional on the field. */
const taken = (app) =>
  app.countRecords('users', $dbx.exp("COALESCE(role, '') != 'queued'"));

/** What the sign-in box and the invite panel show. `max` 0 means no cap, and
 *  the surfaces say nothing at all on one. */
const state = (app) => ({ users: taken(app), max: maxUsers() });

const hasRoom = (app) => {
  const max = maxUsers();
  return max <= 0 || taken(app) < max;
};

/**
 * Which role a row being registered gets: a place if the installation has
 * one, the queue if it does not. The caller is inside the closed beta's
 * transaction, so this counts what the row is about to be written against.
 *
 * The cap and the closed beta are independent. Being full refuses nobody —
 * an invite or a free place still buys an account, and still spends — it only
 * decides whether that account may sign in yet.
 */
const roleForNewUser = (app) => (hasRoom(app) ? MEMBER : QUEUED);

/**
 * Lets a queued account in if a place has opened since it registered, and
 * refuses it if not.
 *
 * First come, first served: whoever authenticates first takes the place.
 * There is no position in the queue and nothing reserves one, so raising
 * `MAXUSERS` admits whoever comes back soonest rather than whoever waited
 * longest.
 *
 * A write during an authentication, so it carries its own transaction — an
 * auth request is not wrapped in one the way the registration create is.
 */
const admitQueued = (app, user) => {
  // `record` is optional on the event, so a missing one is not ours to judge.
  if (!user || user.getString('role') !== QUEUED) return;

  let admitted = false;
  app.runInTransaction((txApp) => {
    if (!hasRoom(txApp)) return;
    user.set('role', MEMBER);
    txApp.save(user);
    admitted = true;
  });

  if (!admitted) {
    throw new ForbiddenError(
      'Ingen ledige plasser, men du er registrert - kom tilbake senere',
      {
        queue: new ValidationError(
          'account_queued',
          'The installation is full; the account is waiting for a place.',
        ),
      },
    );
  }
};

module.exports = {
  state,
  roleForNewUser,
  admitQueued,
};
