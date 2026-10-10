/// <reference path="../pb_data/types.d.ts" />
//
// PocketBase's stock `users` collection ships `updateRule = "id =
// @request.auth.id"` (`migrations/1640988000_init.go`), and a collection rule
// cannot name a field. So a signed-in reader could PATCH their own row and
// set `role = "admin"` — which reaches every spot in the register — or raise
// their own `inviteQuota`.
//
// Null rather than a narrower filter: there is no field left on the row that
// is the reader's to set. `role` and `features` are granted by hand and the
// two invite counters are the closed beta's, all four pinned at create time
// by `pb_hooks/identity.pb.js`. Nothing in the SPA has ever written a user
// row after making it. Superusers and hooks save records directly and are
// not held by an API rule.

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
