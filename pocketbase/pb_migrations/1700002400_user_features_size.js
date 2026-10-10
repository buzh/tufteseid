/// <reference path="../pb_data/types.d.ts" />
//
// Headroom on `users.features`, whose names are the installation's to choose
// and so not this side's to size. 50 kB is some three thousand of them. Over
// the cap the field fails validation and the write it is part of throws.
//
// `fields.add()` with an existing id replaces the field; an omitted property
// is a property removed.

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
