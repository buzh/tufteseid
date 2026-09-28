/// <reference path="../pb_data/types.d.ts" />
//
// `fields.add()` with an existing id replaces the field; an omitted property is
// a property removed. So the field is restated whole.

migrate(
  (app) => {
    const evidence = app.findCollectionByNameOrId('evidence');
    evidence.fields.add(
      new SelectField({
        id: 'evi_kind',
        name: 'kind',
        required: true,
        maxSelect: 1,
        // Must match `EvidenceKind` in `src/api/evidence.ts`. `rvt` is one kind
        // for every RVT blend the sidecar can make; which one is `meta.vis`, so
        // the next blend needs no migration.
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
