/// <reference path="../pb_data/types.d.ts" />
//
// A scene is the arrangement itself, kept as a bilde.
//
// One change: `kind` gains 'scene'. Which
// layers were on, in what order, at what opacity, over which ground — that is
// a reading of the ground as much as any single extract is, and until now it
// had nowhere to live: the only way to keep one was `Ta skjermbilde`, which
// flattens it to a File and loses every component and every parameter.
//
// **No new fields.** A scene is a View of Views and reuses what a sketch
// already added in 1700000700: `over` carries the membership (multiple
// relation → attachments, uncascaded — losing a member unmoors a scene, it
// does not invalidate it) and `meta` carries the order, the per-member opacity
// and the ground spec for the member that is a preset rather than a record.
// The 2 MB ceiling that migration set for a sketch's scene is far more than a
// list of ids and fades needs.
//
// `fields.add()` with an existing id *replaces* the field, so `att_kind` is
// restated in full — an omitted property is a property removed. Values must
// stay in sync with AttachmentKind in src/api/attachments.ts.
//
// Written against the PocketBase v0.23+ JSVM API (App-based, flattened field
// classes). No ES2021 numeric separators — Goja / PB jsvm rejects them.

migrate(
  (app) => {
    const attachments = app.findCollectionByNameOrId('attachments');

    attachments.fields.add(
      new SelectField({
        id: 'att_kind',
        name: 'kind',
        required: true,
        maxSelect: 1,
        values: [
          'extract',
          'screenshot',
          'upload',
          'flyfoto',
          'sketch',
          'scene',
        ],
      }),
    );
    app.save(attachments);
  },
  (app) => {
    const attachments = app.findCollectionByNameOrId('attachments');

    attachments.fields.add(
      new SelectField({
        id: 'att_kind',
        name: 'kind',
        required: true,
        maxSelect: 1,
        values: ['extract', 'screenshot', 'upload', 'flyfoto', 'sketch'],
      }),
    );
    app.save(attachments);
  },
);
