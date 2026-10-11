/// <reference path="../pb_data/types.d.ts" />
//
// Collection ids must not equal any collection name (PocketBase ≥0.23 rejects
// that), hence `pbc_stars` and `pbc_star_counts`.

const OWN_RULE = 'owner = @request.auth.id || @request.auth.role = "admin"';

// A star may be cast on the reader's own spot — it is a bookmark as much as a
// vote, and the favourites list is where it is read. The tally leaves it out
// (`COUNT_QUERY` below), so nobody stars their way up the ranking.
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

    // How many starred a spot is public (`starCounts` below); who did is not.
    const stars = new Collection({
      id: 'pbc_stars',
      name: 'stars',
      type: 'base',
      listRule: OWN_RULE,
      viewRule: OWN_RULE,
      createRule: CREATE_RULE,
      // No update rule at all: a star holds nothing that can change, so
      // retracting is a delete and there is no private spot to PATCH it onto.
      deleteRule: OWN_RULE,
      indexes: [
        // One star per reader per spot. `addStar` creates and treats the
        // resulting 400 as "already starred".
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
      // The favourites list is ordered by it, so it is read and not only kept.
      new AutodateField({ name: 'created', onCreate: true }),
    );

    app.save(stars);

    // The tallies, open to a guest. A view collection carries no realtime
    // feed, and a spot nobody starred is absent rather than present at zero.
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
    // The view reads `stars`, so it goes first.
    try {
      app.delete(app.findCollectionByNameOrId('starCounts'));
    } catch (_) {
      /* already gone */
    }
    try {
      app.delete(app.findCollectionByNameOrId('stars'));
    } catch (_) {
      /* already gone */
    }
  },
);
