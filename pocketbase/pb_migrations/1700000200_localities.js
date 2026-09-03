/// <reference path="../pb_data/types.d.ts" />
//
// Lokaliteter schema — replaces the flat annotations MVP.
// The old `finds` collection (one geometry blob per record) is dropped
// WITH its data and rebuilt as a child of the new `localities`
// collection.
//
// 1. `localities` — the top-level "area to explore": an authored
//    rectangle (bbox), name, description, visibility. Same visibility
//    model as the old finds (privat/begrenset/offentlig; begrenset
//    still behaves as privat until groups exist).
//
// 2. `finds` — child records: one per funn the user marks inside a
//    lokalitet. Carries its own title/note and a lifecycle status
//    (mulig → sannsynlig → avkreftet → rapportert). Geometry is a
//    GeoJSON FeatureCollection (EPSG:4326) so the draw tools round-trip
//    verbatim; usually one shape, but a funn may be several strokes.
//    Read access follows the parent lokalitet's visibility via
//    relation traversal in the rules.
//
// 3. `attachments` — bilder: kept LiDAR extracts, map screenshots and
//    uploads. `file` is a protected file field — private lokaliteter
//    must not have world-readable image URLs, so the client fetches
//    short-lived file tokens (see src/api/attachments.ts).
//
// Collection ids are deliberately *not* equal to the collection names:
// PocketBase ≥0.23 rejects a collection whose name matches any existing
// collection id, its own included.
//
// Written against the PocketBase v0.23+ JSVM API (App-based). No ES2021
// numeric separators — Goja / PB jsvm rejects them.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    // --- 0. drop the MVP finds collection (data intentionally lost) --
    // Only relevant to installs that ran the original MVP migration; a
    // fresh install has nothing here.
    try {
      const oldFinds = app.findCollectionByNameOrId('finds');
      app.delete(oldFinds);
    } catch (_) {
      /* fresh install — never existed */
    }

    // --- 1. localities ----------------------------------------------
    const localities = new Collection({
      id: 'pbc_localities',
      name: 'localities',
      type: 'base',
      // Everything is behind sign-in — no guest reads, even for public.
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
        // [minLon, minLat, maxLon, maxLat] in EPSG:4326 — the authored
        // rectangle, resizable/movable, not derived from content.
        maxSize: 200,
      }),
      new AutodateField({ name: 'created', onCreate: true }),
      new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }),
    );
    app.save(localities);

    // --- 2. finds (child level) -------------------------------------
    // Collection *name* stays `finds`; the id differs from the deleted
    // MVP collection's so nothing can conflate the two schemas.
    const finds = new Collection({
      id: 'finds2',
      name: 'finds',
      type: 'base',
      listRule:
        '@request.auth.id != "" && (locality.visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin")',
      viewRule:
        '@request.auth.id != "" && (locality.visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin")',
      // Only the lokalitet's owner adds funn to it (collaboration is a
      // later, deliberate rule change).
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

    // --- 3. attachments ----------------------------------------------
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
        // Stitched extracts of a big lokalitet can be hefty PNGs.
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
        // Extracts store {sourceKey, sourceLabel, style, metresPerPx,
        // bbox25833} so the gallery can say what an image shows.
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
