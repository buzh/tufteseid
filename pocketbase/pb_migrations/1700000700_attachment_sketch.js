/// <reference path="../pb_data/types.d.ts" />
//
// `fields.add()` with an existing id replaces the field; an omitted
// property is a property removed.

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
