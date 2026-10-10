/// <reference path="../pb_data/types.d.ts" />
//
// What this reader may spend, as a list of feature names. A mirror of the
// Casdoor permissions their roles hold, rewritten from the claims on every
// sign-in and nobody's to edit — `users` has no update rule and
// `pb_hooks/identity.pb.js` saves the record itself (`docs/identity.md`).
//
// Names are the installation's to choose, so nothing here enumerates them.

migrate(
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
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.fields.removeById('users_features');
    app.save(users);
  },
);
