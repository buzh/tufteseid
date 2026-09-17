/// <reference path="../pb_data/types.d.ts" />
//
// A `public` lokalitet becomes readable without an account.
//
// Until now every read rule opened with `@request.auth.id != ""`, so
// `public` meant "any signed-in user" and a shared link — the one surface
// whose entire job is receiving a stranger — could only answer with a
// sign-in dialog over a map of Norway. The visitor was asked to make an
// account before being told what for. `?lok=CODE` now resolves for a guest
// and lands them in the show stance (docs/ui-architecture.md, "The copy, the link, the bundle").
//
// Three rules and one field:
//
// 1. `localities`, `finds`, `attachments` list/view — the public branch
//    drops out of the auth guard and stands on its own; the owner and admin
//    branches keep it, and keep it *explicitly* rather than relying on
//    `owner = @request.auth.id` being false for an empty id.
//
// 2. `attachments.file` → `protected: false`. Without this the records
//    arrive and every image is a blank card: a protected file is only served
//    with a short-lived token from `pb.files.getToken()`, and that endpoint
//    is itself authenticated, so there is no token a guest could hold. The
//    price is that files under *private* lokaliteter are no longer protected
//    by a rule either — the record stays unreadable, so an outsider cannot
//    learn the URL, but a URL that leaks is a URL that works. That is a
//    deliberate trade, taken because the alternative was a lokalitet view
//    with its images missing.
//
// Nothing changes about create, update or delete: authorship is still
// signed-in and still owner-only. Reading is not writing.
//
// `fields.add()` with an existing id *replaces* the field, so `att_file` is
// restated exactly as 1700000600 left it plus the one changed property — an
// omitted property is a property removed.
//
// Written against the PocketBase v0.23+ JSVM API (App-based, flattened field
// classes). No ES2021 numeric separators — Goja / PB jsvm rejects them.

// A guest may read it when the lokalitet is public; everyone else has to be
// signed in and be somebody. `prefix` is '' on localities, where visibility
// is the record's own field, and 'locality.' on the two that hang off it.
const readRule = (prefix) =>
  prefix +
  'visibility = "public" || (@request.auth.id != "" && (owner = ' +
  '@request.auth.id || @request.auth.role = "admin"))';

// What all three said before: the same three branches behind one wall.
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
