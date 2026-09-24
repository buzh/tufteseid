/// <reference path="../pb_data/types.d.ts" />
//
// `fields.add()` with an existing id replaces the field; an omitted property is
// a property removed. So both fields are restated whole.

migrate(
  (app) => {
    const evidence = app.findCollectionByNameOrId('evidence');
    evidence.fields.add(
      new SelectField({
        id: 'evi_kind',
        name: 'kind',
        required: true,
        maxSelect: 1,
        // Must match `EvidenceKind` in `src/api/evidence.ts`. `sunloop` is the
        // render sidecar's, not the browser's.
        values: ['lidar', 'terrain', 'flyfoto', 'sunloop'],
      }),
      new FileField({
        id: 'evi_file',
        name: 'file',
        required: false,
        maxSelect: 1,
        maxSize: 50000000,
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'video/webm'],
        // PocketBase makes no thumb for a video; the sizes stay for the three
        // picture kinds and are simply never asked for on a loop.
        thumbs: ['200x200', '800x0'],
        protected: false,
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
        values: ['lidar', 'terrain', 'flyfoto'],
      }),
      new FileField({
        id: 'evi_file',
        name: 'file',
        required: false,
        maxSelect: 1,
        maxSize: 50000000,
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        thumbs: ['200x200', '800x0'],
        protected: false,
      }),
    );
    app.save(evidence);
  },
);
