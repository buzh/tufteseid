/// <reference path="../pb_data/types.d.ts" />

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
