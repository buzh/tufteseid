/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const evidence = app.findCollectionByNameOrId('evidence');
    evidence.fields.add(
      new SelectField({
        id: 'evi_kind',
        name: 'kind',
        required: true,
        maxSelect: 1,
        values: ['lidar', 'terrain', 'flyfoto', 'sunloop', 'rvt'],
      }),
    );
    app.save(evidence);
  },
  (app) => {
    const evidence = app.findCollectionByNameOrId('evidence');
    evidence.fields.add(
      new SelectField({
        id: 'evi_kind',
        name: 'kind',
        required: true,
        maxSelect: 1,
        values: ['lidar', 'terrain', 'flyfoto', 'sunloop'],
      }),
    );
    app.save(evidence);
  },
);
