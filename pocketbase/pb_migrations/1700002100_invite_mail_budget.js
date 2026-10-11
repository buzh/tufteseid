/// <reference path="../pb_data/types.d.ts" />
//
// How many invite mails an account has had the installation send.
//
// Reversed by `1700002600_drop_invite_mail_budget.js`: a letter is not what
// an invite costs (`docs/closed-beta.md`). This file stays because
// `_migrations` records it and a rename makes PocketBase re-run it.

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
