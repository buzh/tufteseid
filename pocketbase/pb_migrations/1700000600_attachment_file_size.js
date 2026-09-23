/// <reference path="../pb_data/types.d.ts" />
//
// `fields.add()` with an existing id replaces the field; an omitted
// property is a property removed.

migrate(
  (app) => {
    const attachments = app.findCollectionByNameOrId('attachments');
    attachments.fields.add(
      new FileField({
        id: 'att_file',
        name: 'file',
        required: false,
        maxSelect: 1,
        maxSize: 50000000,
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        thumbs: ['200x200', '800x0'],
        protected: true,
      }),
    );
    app.save(attachments);
  },
  (app) => {
    const attachments = app.findCollectionByNameOrId('attachments');
    attachments.fields.add(
      new FileField({
        id: 'att_file',
        name: 'file',
        required: false,
        maxSelect: 1,
        maxSize: 20000000,
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        thumbs: ['200x200', '800x0'],
        protected: true,
      }),
    );
    app.save(attachments);
  },
);
