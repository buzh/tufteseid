/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const spots = app.findCollectionByNameOrId('spots');




    const readRule =
      'spot.visibility = "public" || (@request.auth.id != "" && (owner = ' +
      '@request.auth.id || spot.owner = @request.auth.id || ' +
      '@request.auth.role = "admin"))';




    const writeRule =
      'owner = @request.auth.id || spot.owner = @request.auth.id || ' +
      '@request.auth.role = "admin"';

    const evidence = new Collection({
      id: 'pbc_evidence',
      name: 'evidence',
      type: 'base',
      listRule: readRule,
      viewRule: readRule,
      createRule:
        '@request.auth.id != "" && @request.auth.id = owner && ' +
        '(spot.owner = @request.auth.id || @request.auth.role = "admin")',
      updateRule: writeRule,
      deleteRule: writeRule,
      indexes: [
        'CREATE INDEX idx_evidence_spot ON evidence (spot)',
        'CREATE INDEX idx_evidence_owner ON evidence (owner)',
      ],
    });

    evidence.fields.add(
      new RelationField({
        id: 'evi_spot',
        name: 'spot',
        required: true,
        collectionId: spots.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new RelationField({
        id: 'evi_owner',
        name: 'owner',
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new SelectField({
        id: 'evi_kind',
        name: 'kind',
        required: true,
        maxSelect: 1,


        values: ['lidar', 'terrain', 'flyfoto'],
      }),
      new FileField({
        id: 'evi_file',
        name: 'file',


        required: false,
        maxSelect: 1,
        maxSize: 50000000,
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        thumbs: ['200x200', '800x0'],
        protected: false,
      }),
      new TextField({
        id: 'evi_caption',
        name: 'caption',
        required: false,
        max: 500,
      }),
      new JSONField({
        id: 'evi_meta',
        name: 'meta',
        required: false,


        maxSize: 10000,
      }),
      new NumberField({
        id: 'evi_sort',
        name: 'sort',
        required: false,


        onlyInt: false,
      }),
      new AutodateField({ name: 'created', onCreate: true }),
      new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }),
    );

    app.save(evidence);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('evidence'));
    } catch (_) {

    }
  },
);
