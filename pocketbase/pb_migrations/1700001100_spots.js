/// <reference path="../pb_data/types.d.ts" />
//
// `spots` — the new-ui lokalitet, rebuilt from nothing.
//
// The old three-collection model (`localities` + `finds` + `attachments`)
// is left standing and untouched: its data is still on disk and its
// migrations still run. Nothing in the client reads it any more. It is not
// dropped here because a collection dropped before its replacement has been
// lived with loses the test data twice.
//
// What replaces it is one flat record. A spot is a point somebody put on the
// map, a name, a description, and — optionally — what they drew around it.
// There is no parent/child level and no file field: funn and bilder were the
// two halves of the old model that the rebuild has not yet earned back.
//
// Differences from `localities` that are deliberate, not oversights:
//
//  * `point` replaces `bbox`. The old rectangle was authored with corner
//    handles, and the handles were the fiddly part of the surface. A pin at
//    the centre of what you are looking at is one gesture. A reader who needs
//    an extent draws one.
//  * `geometry` is optional. A spot with nothing drawn on it is a legitimate
//    spot — "something is here" is a finding.
//  * `visibility` is two-valued. `limited` was a placeholder on the old
//    collection that behaved as `private` for its whole life; it comes back
//    when groups do, and adding a value to a SelectField later is cheaper
//    than explaining a state that never differed from its neighbour.
//  * `code` is a real column with a unique index. On `localities` it was
//    added later; here the short link (`?lok=CODE`) is part of the first
//    shape, so the index that makes the client's retry-on-collision loop
//    correct exists from the start.
//
// `credit` is denormalized off the account for the same reason it was on
// `localities`: `users` is closed to guests, so a public spot that expanded
// its owner relation would expand to nothing. The author's name has to be a
// string on the record or a guest cannot be told who wrote it.
//
// Read rules follow 1700000900: a public spot needs no account, everything
// else needs one and needs to be somebody. Write rules are owner-only for
// create, owner-or-admin for update and delete — which is what makes the
// client carry two permissions rather than one.
//
// Collection ids are deliberately *not* equal to any collection name:
// PocketBase ≥0.23 rejects a collection whose name matches an existing id.
//
// Written against the PocketBase v0.23+ JSVM API (App-based, flattened field
// classes). No ES2021 numeric separators — Goja / PB jsvm rejects them.

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
        // Six characters of Crockford base32, generated client-side and
        // retried against the unique index above on the 400 it returns.
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
        // [lon, lat] in EPSG:4326 — where the pin was dropped.
        maxSize: 100,
      }),
      new JSONField({
        id: 'spot_sketch',
        name: 'sketch',
        required: false,
        // An Excalidraw scene plus the georeference that puts it back over
        // the ground it was drawn on. Stored as the editor's own element
        // array rather than as GeoJSON: a freedraw stroke, its pressure
        // curve and its stroke width are the drawing, and a round-trip
        // through GeoJSON would keep the path and lose the hand. The cap is
        // the one `finds.geometry` carried.
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
