/// <reference path="../pb_data/types.d.ts" />
//
// The author's name denormalized onto the record: `users` is closed to
// guests, so `expand=owner` is empty for the reader a share link is for.

migrate(
  (app) => {
    const localities = app.findCollectionByNameOrId('localities');
    localities.fields.add(
      new TextField({
        id: 'loc_credit',
        name: 'credit',
        required: false,
        max: 200,
      }),
    );
    app.save(localities);
  },
  (app) => {
    const localities = app.findCollectionByNameOrId('localities');
    localities.fields.removeById('loc_credit');
    app.save(localities);
  },
);
