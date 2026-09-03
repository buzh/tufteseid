/// <reference path="../pb_data/types.d.ts" />
//
// Restore the JSON size limits 1700000200 asks for.
//
// PocketBase 0.22 clamped every json field to its 2 MB default
// (1702134272_set_default_json_max_size.go ran after our JS migration on
// first boot), so databases created by the old image carry 2 MB on all
// three fields regardless of what the migration declared. That is both
// too generous for `bbox`/`meta` and too tight for `geometry` — a
// detailed hand-drawn funn can exceed 2 MB and would be rejected.
//
// Re-applying the fields by id is a no-op on a fresh install and brings
// upgraded installs in line with it.

migrate(
  (app) => {
    const localities = app.findCollectionByNameOrId('localities');
    localities.fields.add(
      new JSONField({
        id: 'loc_bbox',
        name: 'bbox',
        required: true,
        maxSize: 200,
      }),
    );
    app.save(localities);

    const finds = app.findCollectionByNameOrId('finds');
    finds.fields.add(
      new JSONField({
        id: 'find_geometry',
        name: 'geometry',
        required: true,
        maxSize: 5000000,
      }),
    );
    app.save(finds);

    const attachments = app.findCollectionByNameOrId('attachments');
    attachments.fields.add(
      new JSONField({
        id: 'att_meta',
        name: 'meta',
        required: false,
        maxSize: 10000,
      }),
    );
    app.save(attachments);
  },
  (app) => {
    // Nothing to undo — 2 MB is PocketBase's default, and reinstating it
    // would only re-break the limits above.
  },
);
