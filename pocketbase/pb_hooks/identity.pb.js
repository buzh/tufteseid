/// <reference path="../pb_data/types.d.ts" />
//
// Everything on a new `users` row that is not the reader's to choose.
//
// Registration is a plain record create against an open create rule — a
// reader signs themselves up — and a collection rule cannot name a field. So
// without this, a POST carrying `role: "admin"` would be honoured and reach
// every spot in the register, and one carrying `inviteQuota: 500` would mint
// its way past the closed beta.
//
// Past the create there is no way back in: `users` has no update rule at all,
// so these three are only ever moved by a superuser or by a hook
// (`1700002200_users_not_self_writable.js`, `docs/identity.md`).

onRecordCreateRequest((e) => {
  // An administrator adding somebody by hand chooses the whole row.
  if (e.hasSuperuserAuth()) {
    e.next();
    return;
  }

  const capacity = require(`${__hooks}/capacity.js`);

  // A place if the installation has one left, the queue if it does not. The
  // closed beta's handler has already wrapped this in its transaction, so the
  // count is the one the row is written against.
  e.record.set('role', capacity.roleForNewUser(e.app));
  e.record.set('features', []);
  e.record.set('inviteQuota', 0);

  e.next();
}, 'users');
