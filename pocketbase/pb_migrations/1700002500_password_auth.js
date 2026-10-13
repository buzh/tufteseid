/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    unmarshal(
      {
        passwordAuth: { enabled: true, identityFields: ['email'] },
        oauth2: { enabled: false, providers: [] },




        createRule: '',





        authRule: '',
      },
      users,
    );

    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');


    unmarshal({ oauth2: { enabled: true } }, users);
    app.save(users);
  },
);
