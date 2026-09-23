/// <reference path="../pb_data/types.d.ts" />
//
// `fields.add()` with an existing id replaces the field; an omitted
// property is a property removed.

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
