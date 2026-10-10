/// <reference path="../pb_data/types.d.ts" />
//
// Casdoor reports every permission the account resolves to, not only the ones
// this installation has named, so the length of `users.features` is not this
// side's to predict. Over the cap the field fails validation inside the
// sign-in hook, `app.save` throws, and the reader cannot sign in at all —
// which reaches them as a bare 400 and reaches a maintainer only in the admin
// UI's *Logs*. 50 kB is some three thousand names.
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
