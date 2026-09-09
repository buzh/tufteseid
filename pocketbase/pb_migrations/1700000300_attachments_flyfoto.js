/// <reference path="../pb_data/types.d.ts" />
//
// Add 'flyfoto' to attachments.kind: aerial imagery stitched from Norge
// i bilder over a lokalitet's bbox and saved as a Bilde (see
// src/localities/flyfoto.ts and the nib-proxy sidecar). The other kinds
// stay as they were.
//
// `fields.add()` with the existing id (att_kind) replaces the field, so
// this is a full redefinition of just the select — nothing else on the
// collection changes. Values must stay in sync with AttachmentKind in
// src/api/attachments.ts.

migrate(
  (app) => {
    const attachments = app.findCollectionByNameOrId('attachments');
    attachments.fields.add(
      new SelectField({
        id: 'att_kind',
        name: 'kind',
        required: true,
        maxSelect: 1,
        values: ['extract', 'screenshot', 'upload', 'flyfoto'],
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
        values: ['extract', 'screenshot', 'upload'],
      }),
    );
    app.save(attachments);
  },
);
