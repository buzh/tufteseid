/// <reference path="../pb_data/types.d.ts" />
//
// PocketBase's stock `users` collection ships `updateRule = "id =
// @request.auth.id"` (`migrations/1640988000_init.go`), and a collection rule
// cannot name a field. So a signed-in reader could PATCH their own row and
// set `role = "admin"` — which reaches every spot in the register — or raise
// their own `inviteQuota`.
//
// Null rather than a narrower filter: there is no field left on the row that
// is the reader's to set. `role` mirrors Casdoor and `email` and `name` come
// from the same claims (`pb_hooks/identity.pb.js`); the two invite counters
// are the closed beta's (`pb_hooks/closed_beta.pb.js`). Nothing in the SPA
// has ever written a user row. Superusers and hooks save records directly
// and are not held by an API rule.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.updateRule = null;
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.updateRule = 'id = @request.auth.id';
    app.save(users);
  },
);
