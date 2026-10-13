/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    users.fields.add(
      new JSONField({
        id: 'users_features',
        name: 'features',
        required: false,
        maxSize: 50000,
      }),
    );

    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    users.fields.add(
      new JSONField({
        id: 'users_features',
        name: 'features',
        required: false,
        maxSize: 2000,
      }),
    );

    app.save(users);
  },
);
