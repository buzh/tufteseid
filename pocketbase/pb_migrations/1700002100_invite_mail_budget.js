/// <reference path="../pb_data/types.d.ts" />
//
// How many invite mails an account has had the installation send. The mint
// quota cannot double as the mail budget: revoking an invite refunds it, so
// mint → send → revoke → mint would post as many letters as the sender liked
// (`pb_hooks/closed_beta.pb.js`). This counter only goes up, and the send
// route stops at `inviteQuota`.
//
// Nobody's to write over the API: `users` has no update rule reaching it and
// the hook saves the record itself.

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
