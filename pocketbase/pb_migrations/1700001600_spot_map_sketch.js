/// <reference path="../pb_data/types.d.ts" />
//
// Which of a spot's drawings stands on the shared drawing layer. Empty on
// every record written before this and on any spot with no drawing; the client
// reads an empty value as "the `sketch` column", which is the only drawing a
// spot can hold today.

migrate(
  (app) => {
    const spots = app.findCollectionByNameOrId('spots');
    spots.fields.add(
      new TextField({
        id: 'spot_map_sketch',
        name: 'mapSketch',
        required: false,
        // A sketch id. `sketch` is reserved for the column above; anything
        // else names a record a later model hands out.
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
