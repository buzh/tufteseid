/// <reference path="../pb_data/types.d.ts" />
//
// A sketch is a bilde you drew.
//
// Three changes, all on `attachments`, all for the same feature (see
// docs/ui-architecture.md §9.3):
//
// 1. `kind` gains 'sketch' — a transparent Excalidraw overlay registered to a
//    rectangle, stored as a View: the scene is the spec and the figure PNG is
//    pinned onto it afterwards like any extract.
// 2. `funn` — relation → finds, multiple, **no** cascade. What the sketch is
//    about. Deleting the funn must not take the drawing of it with it; a
//    sketch outlives the interpretation that prompted it, which is the same
//    reason `localities.derivedFrom` does not cascade either.
// 3. `over` — self-relation → attachments, multiple, **no** cascade. Which
//    bilder the sketch is a layer on, so it can be offered as an overlay when
//    one of them is in the ground slot. Also uncascaded: losing the underlay
//    unmoors a sketch, it does not invalidate it.
//
// Both relations are seeded at creation from what is on screen and have no
// editor yet; the field is where the answer goes when there is one.
//
// `meta` grows from 10 kB to 2 MB, because for this kind it carries the scene
// itself — the Excalidraw element array — beside the frame. 10 kB is about
// three strokes. The client strips `versionNonce`/`updated` and dropped
// elements before it writes and refuses a scene over its own budget, so this
// ceiling is the backstop rather than the limit that bites; it is sized for a
// few hundred freedraw strokes at full point density. It applies to every
// kind, which costs nothing: no other kind writes more than a kilobyte, and a
// per-kind ceiling is not a thing a select-and-json pair can express.
//
// `fields.add()` with an existing id *replaces* the field, so `att_kind` and
// `att_meta` are restated in full — an omitted property is a property
// removed. Values must stay in sync with AttachmentKind in
// src/api/attachments.ts.
//
// Written against the PocketBase v0.23+ JSVM API (App-based, flattened field
// classes). No ES2021 numeric separators — Goja / PB jsvm rejects them.

migrate(
  (app) => {
    const attachments = app.findCollectionByNameOrId('attachments');
    const finds = app.findCollectionByNameOrId('finds');

    attachments.fields.add(
      new SelectField({
        id: 'att_kind',
        name: 'kind',
        required: true,
        maxSelect: 1,
        values: ['extract', 'screenshot', 'upload', 'flyfoto', 'sketch'],
      }),
      new JSONField({
        id: 'att_meta',
        name: 'meta',
        required: false,
        maxSize: 2000000,
      }),
      new RelationField({
        id: 'att_funn',
        name: 'funn',
        required: false,
        collectionId: finds.id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 999,
      }),
      new RelationField({
        id: 'att_over',
        name: 'over',
        required: false,
        collectionId: attachments.id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 999,
      }),
    );
    app.save(attachments);
  },
  (app) => {
    const attachments = app.findCollectionByNameOrId('attachments');

    attachments.fields.removeById('att_funn');
    attachments.fields.removeById('att_over');
    attachments.fields.add(
      new SelectField({
        id: 'att_kind',
        name: 'kind',
        required: true,
        maxSelect: 1,
        values: ['extract', 'screenshot', 'upload', 'flyfoto'],
      }),
      new JSONField({
        id: 'att_meta',
        name: 'meta',
        required: false,
        maxSize: 10000,
      }),
    );
    app.save(attachments);
  },
);
