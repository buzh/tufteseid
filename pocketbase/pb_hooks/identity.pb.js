/// <reference path="../pb_data/types.d.ts" />
//
// Everything on a `users` row that is not the reader's to choose.
//
// Registration is a plain record create against an open create rule — a
// reader signs themselves up — and a collection rule cannot name a field. So
// without this, a POST carrying `role: "admin"` would be honoured and reach
// every spot in the register, and one carrying `inviteQuota: 500` would mint
// its way past the closed beta.
//
// The same holds on an update, the reader's own row being theirs to edit
// again (`1700002900_user_profile.js`): the rule says which row, never which
// field, so the three are put back on every PATCH.
//
// `email` and `verified` are not here because the upsert form already pins
// them to the stored value for anything short of manage access, and nothing
// grants that. Moving the address is `profile.pb.js`' route
// (`docs/identity.md`).

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

// PocketBase loads the request body onto the record before this runs and
// validates it inside `e.next()`, so what is put back here is what gets
// saved. `original()` is the row as it came out of the database, the load
// above having touched only the current data.
onRecordUpdateRequest((e) => {
  // An administrator editing a row by hand chooses the whole of it.
  if (e.hasSuperuserAuth()) {
    e.next();
    return;
  }

  const stored = e.record.original();
  ['role', 'features', 'inviteQuota'].forEach((field) => {
    e.record.set(field, stored.get(field));
  });

  e.next();
}, 'users');
