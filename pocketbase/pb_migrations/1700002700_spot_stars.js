/// <reference path="../pb_data/types.d.ts" />

const OWN_RULE = 'owner = @request.auth.id || @request.auth.role = "admin"';

const CREATE_RULE = [
  '@request.auth.id != ""',
  '@request.auth.id = owner',
  'spot.visibility = "public"',
].join(' && ');

const COUNT_QUERY = [
  'SELECT t.spot AS id, t.spot AS spot,',
  '       COUNT(*) AS stars',
  'FROM stars t JOIN spots s ON s.id = t.spot',
  "WHERE s.visibility = 'public' AND t.owner != s.owner",
  'GROUP BY t.spot',
].join('\n');

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const spots = app.findCollectionByNameOrId('spots');

    const stars = new Collection({
      id: 'pbc_stars',
      name: 'stars',
      type: 'base',
      listRule: OWN_RULE,
      viewRule: OWN_RULE,
      createRule: CREATE_RULE,
      deleteRule: OWN_RULE,
      indexes: [
        'CREATE UNIQUE INDEX idx_stars_owner_spot ON stars (owner, spot)',
        'CREATE INDEX idx_stars_spot ON stars (spot)',
      ],
    });

    stars.fields.add(
      new RelationField({
        id: 'str_owner',
        name: 'owner',
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new RelationField({
        id: 'str_spot',
        name: 'spot',
        required: true,
        collectionId: spots.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new AutodateField({ name: 'created', onCreate: true }),
    );

    app.save(stars);

    const counts = new Collection({
      id: 'pbc_star_counts',
      name: 'starCounts',
      type: 'view',
      listRule: '',
      viewRule: '',
      viewQuery: COUNT_QUERY,
    });

    app.save(counts);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('starCounts'));
    } catch (_) {
    }
    try {
      app.delete(app.findCollectionByNameOrId('stars'));
    } catch (_) {
    }
  },
);
