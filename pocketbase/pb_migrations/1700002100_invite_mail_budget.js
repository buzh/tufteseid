/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    users.fields.add(
      new NumberField({
        id: 'users_invites_sent',
        name: 'invitesSent',
        required: false,
        onlyInt: true,
        min: 0,
      }),
    );

    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.fields.removeById('users_invites_sent');
    app.save(users);
  },
);
