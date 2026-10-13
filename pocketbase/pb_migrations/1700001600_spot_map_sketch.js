/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const spots = app.findCollectionByNameOrId('spots');
    spots.fields.add(
      new TextField({
        id: 'spot_map_sketch',
        name: 'mapSketch',
        required: false,
        max: 60,
      }),
    );
    app.save(spots);
  },
  (app) => {
    const spots = app.findCollectionByNameOrId('spots');
    spots.fields.removeById('spot_map_sketch');
    app.save(spots);
  },
);
