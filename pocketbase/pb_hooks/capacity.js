/// <reference path="../pb_data/types.d.ts" />

const QUEUED = 'queued';
const MEMBER = 'user';

const maxUsers = () => {
  const asked = parseInt($os.getenv('MAXUSERS') || '', 10);
  return Number.isFinite(asked) && asked > 0 ? asked : 0;
};

const taken = (app) =>
  app.countRecords('users', $dbx.exp("COALESCE(role, '') != 'queued'"));

const state = (app) => ({ users: taken(app), max: maxUsers() });

const hasRoom = (app) => {
  const max = maxUsers();
  return max <= 0 || taken(app) < max;
};

const roleForNewUser = (app) => (hasRoom(app) ? MEMBER : QUEUED);

const admitQueued = (app, user) => {

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
