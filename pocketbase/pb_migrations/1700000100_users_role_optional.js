/// <reference path="../pb_data/types.d.ts" />
//
// Fix: relax users.role so PocketBase's OAuth auto-provisioning can
// create records. PB populates only its known fields on OAuth signup
// (email, name, avatar, verified); our added `role` had no default,
// so `required: true` caused every first-time OAuth login to fail
// with a generic 400 "Failed to authenticate".
//
// The frontend (`roleAtom`) already treats a missing role as 'user',
// so nullable + no default is the intended behaviour.
//
// `fields.add()` replaces an existing field with the same id, so this
// is a full redefinition rather than an in-place mutation.

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
