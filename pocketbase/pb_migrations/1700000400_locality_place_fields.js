/// <reference path="../pb_data/types.d.ts" />
//
// Where a lokalitet *is*, as three editable strings.
//
// Until now the only place to record "this is the knoll behind Storevike
// in Vang, on gnr 12/6" was the free-text Beskrivelse, which made it
// unsearchable and unscannable. These three carry it instead, pre-filled
// at creation from GeoNorge (see src/localities/localityContext.ts) and
// editable afterwards like any other field.
//
// All three are optional text, not relations or structured JSON: the
// register's answer is a *starting point*, and the user must be able to
// correct or replace it with prose the register doesn't hold ("øvre
// Storevike, ved den gamle stien"). Nothing downstream parses them.
//
// The centre coordinate is deliberately NOT a field here — it is derived
// from bbox at render time (formatBboxCentre), so it can never drift out
// of step with a rectangle that "Juster området" has moved.

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
