/// <reference path="../pb_data/types.d.ts" />
//
// Collection ids must not equal any collection name: PocketBase ≥0.23
// rejects a collection whose name matches an existing id. No ES2021 numeric
// separators anywhere in these files — Goja / PB jsvm rejects them.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    const spots = new Collection({
      id: 'pbc_spots',
      name: 'spots',
      type: 'base',
      listRule:
        'visibility = "public" || (@request.auth.id != "" && (owner = ' +
        '@request.auth.id || @request.auth.role = "admin"))',
      viewRule:
        'visibility = "public" || (@request.auth.id != "" && (owner = ' +
        '@request.auth.id || @request.auth.role = "admin"))',
      createRule: '@request.auth.id != "" && @request.auth.id = owner',
      updateRule: 'owner = @request.auth.id || @request.auth.role = "admin"',
      deleteRule: 'owner = @request.auth.id || @request.auth.role = "admin"',
      indexes: [
        'CREATE UNIQUE INDEX idx_spots_code ON spots (code)',
        'CREATE INDEX idx_spots_owner ON spots (owner)',
        'CREATE INDEX idx_spots_visibility ON spots (visibility)',
      ],
    });

    spots.fields.add(
      new RelationField({
        id: 'spot_owner',
        name: 'owner',
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new TextField({
        id: 'spot_code',
        name: 'code',
        required: true,
        // Crockford base32, generated client-side and retried against the
        // unique index above on the 400 it returns.
        min: 6,
        max: 6,
      }),
      new TextField({
        id: 'spot_name',
        name: 'name',
        required: true,
        min: 1,
        max: 200,
      }),
      new TextField({
        id: 'spot_description',
        name: 'description',
        required: false,
        max: 20000,
      }),
      new TextField({
        id: 'spot_credit',
        name: 'credit',
        required: false,
        max: 200,
      }),
      new SelectField({
        id: 'spot_visibility',
        name: 'visibility',
        required: true,
        maxSelect: 1,
        values: ['private', 'public'],
      }),
      new JSONField({
        id: 'spot_point',
        name: 'point',
        required: true,
        // [lon, lat], EPSG:4326.
        maxSize: 100,
      }),
      new JSONField({
        id: 'spot_sketch',
        name: 'sketch',
        required: false,
        // An Excalidraw element array plus the frame that georeferences it.
        maxSize: 5000000,
      }),
      new AutodateField({ name: 'created', onCreate: true }),
      new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }),
    );

    app.save(spots);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('spots'));
    } catch (_) {
      /* already gone */
    }
  },
);
