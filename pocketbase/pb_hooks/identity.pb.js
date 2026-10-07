/// <reference path="../pb_data/types.d.ts" />
//
// Casdoor is where a reader's role lives. The `users` row carries a copy
// because every collection rule in `pb_migrations/` reads
// `@request.auth.role` and PocketBase can only judge a record of its own, so
// the copy is rewritten from the claims on every sign-in and is nobody's to
// edit (`1700002200_users_not_self_writable.js`, `docs/identity.md`).
//
// Every handler runs in a runtime of its own and cannot see this file's
// scope, so the logic lives in `identity.js` and is required in.

onRecordAuthWithOAuth2Request((e) => {
  const identity = require(`${__hooks}/identity.js`);
  const role = identity.roleFromClaims(e.oAuth2User);

  // An existing row is reconciled before `e.next()`, which is what writes the
  // auth response: a role saved after it would not be in the body the browser
  // has just been handed, and the reader would hold the old one until their
  // next refresh.
  if (!e.isNewRecord) {
    identity.applyRole(e.app, e.record, role);
    e.next();
    return;
  }

  // A new row has nothing to save against until it exists, so its turn comes
  // after. The first sign-in of an account Casdoor already calls an
  // administrator therefore answers without the rank; `authRefresh` on the
  // next load picks it up.
  e.next();
  identity.applyRole(e.app, e.record, role);
}, 'users');
