/// <reference path="../pb_data/types.d.ts" />
//
// Collection ids must not equal any collection name (PocketBase ≥0.23 rejects
// that), hence `pbc_evidence`.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const spots = app.findCollectionByNameOrId('spots');

    // Public spots are readable with no account, and a guest can hold no file
    // token, so an unprotected file is what makes the picture visible at all.
    // The trade is that a file URL under a private spot works if it leaks.
    const readRule =
      'spot.visibility = "public" || (@request.auth.id != "" && (owner = ' +
      '@request.auth.id || spot.owner = @request.auth.id || ' +
      '@request.auth.role = "admin"))';

    // The spot's owner too, not only the row's: an admin may keep a render
    // against somebody else's spot, and that spot's author must still be able
    // to caption and delete it. One permission in the UI, `mayEdit`.
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
        // Which producer made the pixels. Must match `EvidenceKind` in
        // `src/api/evidence.ts`.
        values: ['lidar', 'terrain', 'flyfoto'],
      }),
      new FileField({
        id: 'evi_file',
        name: 'file',
        // Empty until the render lands; the row exists first so a render that
        // fails has something to hang a retry on.
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
        // The parameters the render was asked for, the rectangle it covers, the
        // resolution it achieved and when it was made. No pixels.
        maxSize: 10000,
      }),
      new NumberField({
        id: 'evi_sort',
        name: 'sort',
        required: false,
        // Epoch milliseconds at creation, so a producer that does not hold the
        // list still lands last. An ordering key, not an index.
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
      /* already gone */
    }
  },
);
