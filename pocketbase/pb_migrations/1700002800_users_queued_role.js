/// <reference path="../pb_data/types.d.ts" />

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
