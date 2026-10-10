/// <reference path="../pb_data/types.d.ts" />
//
// `role` is optional on the field and pinned at create instead, by
// `pb_hooks/identity.pb.js` — a required SelectField would have to be sent by
// whoever makes the row, which on registration is the reader.
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
        values: ['guest', 'user', 'admin'],
      }),
    );
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.fields.add(
      new SelectField({
        id: 'users_role',
        name: 'role',
        required: true,
        maxSelect: 1,
        values: ['guest', 'user', 'admin'],
      }),
    );
    app.save(users);
  },
);
