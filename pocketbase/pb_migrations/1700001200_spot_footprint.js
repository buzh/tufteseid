/// <reference path="../pb_data/types.d.ts" />
//
// Null on every record written before this, and on any spot with no footprint.

migrate(
  (app) => {
    const spots = app.findCollectionByNameOrId('spots');
    spots.fields.add(
      new JSONField({
        id: 'spot_footprint',
        name: 'footprint',
        required: false,
        // [minLon, minLat, maxLon, maxLat], EPSG:4326. Square in EPSG:25833
        // and capped at MAX_SIDE_M (`src/map/bbox.ts`); neither is enforced
        // here, because the cap is a fact about what the producers can render.
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
