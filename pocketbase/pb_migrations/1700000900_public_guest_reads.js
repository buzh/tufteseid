/// <reference path="../pb_data/types.d.ts" />
//
// `attachments.file` becomes unprotected: a protected file is only served
// against a token from an authenticated endpoint, so a guest can hold none.
// A file URL under a private lokalitet therefore works if it leaks.
//
// `fields.add()` with an existing id replaces the field; an omitted
// property is a property removed.

// `prefix` is '' on localities, where visibility is the record's own field,
// and 'locality.' on the two that hang off it.
const readRule = (prefix) =>
  prefix +
  'visibility = "public" || (@request.auth.id != "" && (owner = ' +
  '@request.auth.id || @request.auth.role = "admin"))';

const signedInReadRule = (prefix) =>
  '@request.auth.id != "" && (' +
  prefix +
  'visibility = "public" || owner = @request.auth.id || ' +
  '@request.auth.role = "admin")';

const fileField = (isProtected) =>
  new FileField({
    id: 'att_file',
    name: 'file',
    required: false,
    maxSelect: 1,
    maxSize: 50000000,
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    thumbs: ['200x200', '800x0'],
    protected: isProtected,
  });

migrate(
  (app) => {
    const localities = app.findCollectionByNameOrId('localities');
    localities.listRule = readRule('');
    localities.viewRule = readRule('');
    app.save(localities);

    const finds = app.findCollectionByNameOrId('finds');
    finds.listRule = readRule('locality.');
    finds.viewRule = readRule('locality.');
    app.save(finds);

    const attachments = app.findCollectionByNameOrId('attachments');
    attachments.listRule = readRule('locality.');
    attachments.viewRule = readRule('locality.');
    attachments.fields.add(fileField(false));
    app.save(attachments);
  },
  (app) => {
    const localities = app.findCollectionByNameOrId('localities');
    localities.listRule = signedInReadRule('');
    localities.viewRule = signedInReadRule('');
    app.save(localities);

    const finds = app.findCollectionByNameOrId('finds');
    finds.listRule = signedInReadRule('locality.');
    finds.viewRule = signedInReadRule('locality.');
    app.save(finds);

    const attachments = app.findCollectionByNameOrId('attachments');
    attachments.listRule = signedInReadRule('locality.');
    attachments.viewRule = signedInReadRule('locality.');
    attachments.fields.add(fileField(true));
    app.save(attachments);
  },
);
