/// <reference path="../pb_data/types.d.ts" />
//
// Collection ids must not equal any collection name: PocketBase ≥0.23
// rejects a collection whose name matches an existing id.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    // Drops the MVP finds collection with its data.
    try {
      const oldFinds = app.findCollectionByNameOrId('finds');
      app.delete(oldFinds);
    } catch (_) {
      /* fresh install — never existed */
    }

    const localities = new Collection({
      id: 'pbc_localities',
      name: 'localities',
      type: 'base',
      listRule:
        '@request.auth.id != "" && (visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin")',
      viewRule:
        '@request.auth.id != "" && (visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin")',
      createRule: '@request.auth.id != "" && @request.auth.id = owner',
      updateRule: 'owner = @request.auth.id || @request.auth.role = "admin"',
      deleteRule: 'owner = @request.auth.id || @request.auth.role = "admin"',
      indexes: [
        'CREATE INDEX idx_localities_owner ON localities (owner)',
        'CREATE INDEX idx_localities_visibility ON localities (visibility)',
      ],
    });
    localities.fields.add(
      new RelationField({
        id: 'loc_owner',
        name: 'owner',
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new TextField({
        id: 'loc_name',
        name: 'name',
        required: true,
        min: 1,
        max: 200,
      }),
      new TextField({
        id: 'loc_description',
        name: 'description',
        required: false,
        max: 20000,
      }),
      new SelectField({
        id: 'loc_visibility',
        name: 'visibility',
        required: true,
        maxSelect: 1,
        values: ['private', 'limited', 'public'],
      }),
      new JSONField({
        id: 'loc_bbox',
        name: 'bbox',
        required: true,
        // [minLon, minLat, maxLon, maxLat], EPSG:4326.
        maxSize: 200,
      }),
      new AutodateField({ name: 'created', onCreate: true }),
      new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }),
    );
    app.save(localities);

    // Name stays `finds`; the id differs from the deleted MVP collection's.
    const finds = new Collection({
      id: 'finds2',
      name: 'finds',
      type: 'base',
      listRule:
        '@request.auth.id != "" && (locality.visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin")',
      viewRule:
        '@request.auth.id != "" && (locality.visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin")',
      createRule:
        '@request.auth.id != "" && @request.auth.id = owner && locality.owner = @request.auth.id',
      updateRule: 'owner = @request.auth.id || @request.auth.role = "admin"',
      deleteRule: 'owner = @request.auth.id || @request.auth.role = "admin"',
      indexes: [
        'CREATE INDEX idx_finds_locality ON finds (locality)',
        'CREATE INDEX idx_finds_owner ON finds (owner)',
      ],
    });
    finds.fields.add(
      new RelationField({
        id: 'find_locality',
        name: 'locality',
        required: true,
        collectionId: localities.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new RelationField({
        id: 'find_owner',
        name: 'owner',
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new TextField({
        id: 'find_title',
        name: 'title',
        required: true,
        min: 1,
        max: 200,
      }),
      new TextField({
        id: 'find_note',
        name: 'note',
        required: false,
        max: 20000,
      }),
      new SelectField({
        id: 'find_status',
        name: 'status',
        required: true,
        maxSelect: 1,
        values: ['mulig', 'sannsynlig', 'avkreftet', 'rapportert'],
      }),
      new JSONField({
        id: 'find_geometry',
        name: 'geometry',
        required: true,
        maxSize: 5000000,
      }),
      new AutodateField({ name: 'created', onCreate: true }),
      new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }),
    );
    app.save(finds);

    const attachments = new Collection({
      id: 'pbc_attachments',
      name: 'attachments',
      type: 'base',
      listRule:
        '@request.auth.id != "" && (locality.visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin")',
      viewRule:
        '@request.auth.id != "" && (locality.visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin")',
      createRule:
        '@request.auth.id != "" && @request.auth.id = owner && locality.owner = @request.auth.id',
      updateRule: 'owner = @request.auth.id || @request.auth.role = "admin"',
      deleteRule: 'owner = @request.auth.id || @request.auth.role = "admin"',
      indexes: [
        'CREATE INDEX idx_attachments_locality ON attachments (locality)',
        'CREATE INDEX idx_attachments_owner ON attachments (owner)',
      ],
    });
    attachments.fields.add(
      new RelationField({
        id: 'att_locality',
        name: 'locality',
        required: true,
        collectionId: localities.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new RelationField({
        id: 'att_owner',
        name: 'owner',
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new SelectField({
        id: 'att_kind',
        name: 'kind',
        required: true,
        maxSelect: 1,
        values: ['extract', 'screenshot', 'upload'],
      }),
      new FileField({
        id: 'att_file',
        name: 'file',
        required: true,
        maxSelect: 1,
        maxSize: 20000000,
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        thumbs: ['200x200', '800x0'],
        protected: true,
      }),
      new TextField({
        id: 'att_caption',
        name: 'caption',
        required: false,
        max: 500,
      }),
      new JSONField({
        id: 'att_meta',
        name: 'meta',
        required: false,
        maxSize: 10000,
      }),
      new AutodateField({ name: 'created', onCreate: true }),
      new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }),
    );
    app.save(attachments);
  },
  (app) => {
    for (const name of ['attachments', 'finds', 'localities']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {
        /* already gone */
      }
    }
  },
);
