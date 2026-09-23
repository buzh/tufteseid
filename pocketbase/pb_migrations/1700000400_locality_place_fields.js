/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const localities = app.findCollectionByNameOrId('localities');
    localities.fields.add(
      new TextField({
        id: 'loc_place',
        name: 'place',
        required: false,
        max: 200,
      }),
      new TextField({
        id: 'loc_municipality',
        name: 'municipality',
        required: false,
        max: 200,
      }),
      new TextField({
        id: 'loc_matrikkel',
        name: 'matrikkel',
        required: false,
        max: 500,
      }),
    );
    app.save(localities);
  },
  (app) => {
    const localities = app.findCollectionByNameOrId('localities');
    localities.fields.removeById('loc_place');
    localities.fields.removeById('loc_municipality');
    localities.fields.removeById('loc_matrikkel');
    app.save(localities);
  },
);
