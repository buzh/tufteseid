/// <reference path="../pb_data/types.d.ts" />

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
