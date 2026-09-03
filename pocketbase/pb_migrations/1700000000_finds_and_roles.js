/// <reference path="../pb_data/types.d.ts" />
//
// Adds a `role` field to the built-in `users` collection.
// Values: guest / user / admin.
// (Guest is a policy label for signed-out visitors; no user record ever
// has role='guest' in practice, but keeping it in the enum documents the
// tier and leaves room for signup-limited invites.)
//
// The filename still says "finds_and_roles" because it is recorded
// verbatim in the `_migrations` table of every existing install —
// renaming it would make PocketBase re-run it. The `finds` collection it
// used to create was an MVP that 1700000200_localities.js drops again, so
// only the role half survives here.
//
// Written against the PocketBase v0.23+ JSVM API (App-based). No ES2021
// numeric separators — Goja / PB jsvm rejects them.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.fields.add(
      new SelectField({
        id: 'users_role',
        name: 'role',
        // Relaxed to optional by 1700000100 — see the note there.
        required: true,
        maxSelect: 1,
        values: ['guest', 'user', 'admin'],
      }),
    );
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.fields.removeById('users_role');
    app.save(users);
  },
);
