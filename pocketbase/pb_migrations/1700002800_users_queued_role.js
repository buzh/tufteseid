/// <reference path="../pb_data/types.d.ts" />
//
// `queued` joins the role values. An account registered while the
// installation is at `MAXUSERS` is written with it: the row exists and the
// invite or free place it cost is spent, but it holds no place and cannot
// sign in until one opens (`docs/identity.md`).
//
// `fields.add()` replaces the field by id.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.fields.add(
      new SelectField({
        id: 'users_role',
        name: 'role',
        required: false,
        maxSelect: 1,
        values: ['guest', 'user', 'admin', 'queued'],
      }),
    );
    app.save(users);
  },
  (app) => {
    // Let everybody waiting in before the value they hold stops being one the
    // field would take. The cap is gone with this migration anyway.
    app
      .db()
      .newQuery("UPDATE users SET role = 'user' WHERE role = 'queued'")
      .execute();

    const users = app.findCollectionByNameOrId('users');
    users.fields.add(
      new SelectField({
        id: 'users_role',
        name: 'role',
        required: false,
        maxSelect: 1,
        values: ['guest', 'user', 'admin'],
      }),
    );
    app.save(users);
  },
);
