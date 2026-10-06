/// <reference path="../pb_data/types.d.ts" />
//
// The closed beta. A `users` row is only created when the gate says so, which
// is enforced in `pb_hooks/closed_beta.pb.js` rather than here: an API rule
// cannot count rows or decrement a counter.
//
// Collection ids must not equal any collection name (PocketBase ≥0.23 rejects
// that), hence `pbc_registration` and `pbc_invites`.
//
// The seeded row closes registration on the first boot after this lands. Open
// it with one UPDATE (`docs/closed-beta.md`).

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    // One row, read by a guest: the sign-in box says how many places are left
    // before the reader leaves for the identity provider.
    const registration = new Collection({
      id: 'pbc_registration',
      name: 'registration',
      type: 'base',
      listRule: '',
      viewRule: '',
      // The gate is nobody's to move over the API. SQL or the admin UI.
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });

    registration.fields.add(
      new NumberField({
        id: 'reg_open_slots',
        name: 'openSlots',
        required: false,
        onlyInt: true,
        min: 0,
      }),
      // Not `required`: a required BoolField in PocketBase means "must be
      // true", which would pin the gate shut.
      new BoolField({ id: 'reg_closed', name: 'closed', required: false }),
      new AutodateField({ name: 'created', onCreate: true }),
      new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }),
    );

    app.save(registration);

    const gate = new Record(registration);
    gate.set('openSlots', 0);
    gate.set('closed', true);
    app.save(gate);

    const mine = 'issuer = @request.auth.id || @request.auth.role = "admin"';

    const invites = new Collection({
      id: 'pbc_invites',
      name: 'invites',
      type: 'base',
      listRule: mine,
      viewRule: mine,
      // The hook mints the code and checks the quota; the client sends
      // neither. Minting is the only write a reader makes here.
      createRule: '@request.auth.id != "" && issuer = @request.auth.id',
      // Redeeming and sending are the hook's, with no rule to answer to.
      updateRule: null,
      // Revoking, which refunds the quota. A spent invite is a record of an
      // admission and stays.
      deleteRule: `(${mine}) && redeemedAt = ""`,
      indexes: [
        'CREATE UNIQUE INDEX idx_invites_code ON invites (code)',
        'CREATE INDEX idx_invites_issuer ON invites (issuer)',
      ],
    });

    invites.fields.add(
      new TextField({
        id: 'inv_code',
        name: 'code',
        required: true,
        max: 32,
      }),
      new RelationField({
        id: 'inv_issuer',
        name: 'issuer',
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      // No cascade, unlike `issuer`: an invitee closing their account must not
      // erase the issuer's record of having spent the invite. `redeemedAt` is
      // what says the invite is spent, and it survives.
      new RelationField({
        id: 'inv_redeemed_by',
        name: 'redeemedBy',
        required: false,
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      }),
      new DateField({ id: 'inv_redeemed_at', name: 'redeemedAt' }),
      // The address it was last mailed to, so the issuer can see where it
      // went. Empty means they passed the code on themselves.
      new EmailField({ id: 'inv_email', name: 'email', required: false }),
      new DateField({ id: 'inv_sent_at', name: 'sentAt' }),
      new AutodateField({ name: 'created', onCreate: true }),
      new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }),
    );

    app.save(invites);

    // How many invites this reader may ever mint. Granted by hand in SQL;
    // what is left to mint is the quota less the rows they have issued, so
    // revoking an unspent one gives it back.
    users.fields.add(
      new NumberField({
        id: 'users_invite_quota',
        name: 'inviteQuota',
        required: false,
        onlyInt: true,
        min: 0,
      }),
    );
    app.save(users);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('invites'));
    } catch (_) {
      /* already gone */
    }
    try {
      app.delete(app.findCollectionByNameOrId('registration'));
    } catch (_) {
      /* already gone */
    }
    try {
      const users = app.findCollectionByNameOrId('users');
      users.fields.removeById('users_invite_quota');
      app.save(users);
    } catch (_) {
      /* already gone */
    }
  },
);
