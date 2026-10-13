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
        values: ['lidar', 'terrain', 'flyfoto', 'sunloop'],
      }),
      new FileField({
        id: 'evi_file',
        name: 'file',
        required: false,
        maxSelect: 1,
        maxSize: 50000000,
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'video/webm'],
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
