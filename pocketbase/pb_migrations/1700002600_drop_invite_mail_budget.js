/// <reference path="../pb_data/types.d.ts" />
//
// Drops the mail budget `1700002100_invite_mail_budget.js` added. A letter is
// not a currency: what an invite costs is the quota row it was minted
// against, and whether the code was redeemed is the only thing that decides
// it is spent (`docs/closed-beta.md`).

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.fields.removeById('users_invites_sent');
    app.save(users);
  },
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
);
