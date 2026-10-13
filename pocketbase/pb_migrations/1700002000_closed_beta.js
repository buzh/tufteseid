/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');



    const registration = new Collection({
      id: 'pbc_registration',
      name: 'registration',
      type: 'base',
      listRule: '',
      viewRule: '',

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


      createRule: '@request.auth.id != "" && issuer = @request.auth.id',

      updateRule: null,


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



      new RelationField({
        id: 'inv_redeemed_by',
        name: 'redeemedBy',
        required: false,
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      }),
      new DateField({ id: 'inv_redeemed_at', name: 'redeemedAt' }),


      new EmailField({ id: 'inv_email', name: 'email', required: false }),
      new DateField({ id: 'inv_sent_at', name: 'sentAt' }),
      new AutodateField({ name: 'created', onCreate: true }),
      new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }),
    );

    app.save(invites);




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

    }
    try {
      app.delete(app.findCollectionByNameOrId('registration'));
    } catch (_) {

    }
    try {
      const users = app.findCollectionByNameOrId('users');
      users.fields.removeById('users_invite_quota');
      app.save(users);
    } catch (_) {

    }
  },
);
