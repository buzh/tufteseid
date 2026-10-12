/// <reference path="../pb_data/types.d.ts" />
//
// The reader's own row, theirs to edit again: a display name, a picture and a
// line about themselves (`docs/identity.md`).
//
// This hands back the update rule `1700002200_users_not_self_writable.js`
// took away. What made that necessary has not changed — a collection rule
// still cannot name a field, so the rule alone would let a PATCH carry
// `role: "admin"` — but `pb_hooks/identity.pb.js` now puts the three pinned
// fields back on an update the way it already pinned them at create, which is
// what makes the rule safe to hold again.
//
// `email` and `verified` need no pinning: the upsert form refuses either to
// anything short of manage access, which nothing here grants. Moving the
// address is `pb_hooks/profile.pb.js`' route.
//
// Only the line is new. `avatar` is already on the stock collection.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    users.fields.add(
      new TextField({
        id: 'users_description',
        name: 'description',
        required: false,
        max: 120,
      }),
    );

    users.updateRule = 'id = @request.auth.id';
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.fields.removeById('users_description');
    users.updateRule = null;
    app.save(users);
  },
);
