/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const spots = app.findCollectionByNameOrId('spots');
    spots.fields.add(
      new JSONField({
        id: 'spot_footprint',
        name: 'footprint',
        required: false,
        maxSize: 200,
      }),
    );
    app.save(spots);
  },
  (app) => {
    const spots = app.findCollectionByNameOrId('spots');
    spots.fields.removeById('spot_footprint');
    app.save(spots);
  },
);
