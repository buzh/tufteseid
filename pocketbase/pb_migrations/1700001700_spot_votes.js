/// <reference path="../pb_data/types.d.ts" />
//
// Collection ids must not equal any collection name (PocketBase ≥0.23 rejects
// that), hence `pbc_votes` and `pbc_spot_scores`.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const spots = app.findCollectionByNameOrId('spots');

    // How a spot stands is public (`spotScores` below); who voted is not.
    const ownRule = 'owner = @request.auth.id || @request.auth.role = "admin"';

    const votes = new Collection({
      id: 'pbc_votes',
      name: 'votes',
      type: 'base',
      listRule: ownRule,
      viewRule: ownRule,
      // A private spot is nobody's to rank, its owner's included.
      createRule:
        '@request.auth.id != "" && @request.auth.id = owner && ' +
        'spot.visibility = "public"',
      updateRule: ownRule,
      deleteRule: ownRule,
      indexes: [
        // One vote per reader per spot. `castVote` creates and treats the
        // resulting 400 as "already voted, update instead".
        'CREATE UNIQUE INDEX idx_votes_owner_spot ON votes (owner, spot)',
        'CREATE INDEX idx_votes_spot ON votes (spot)',
      ],
    });

    votes.fields.add(
      new RelationField({
        id: 'vot_owner',
        name: 'owner',
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new RelationField({
        id: 'vot_spot',
        name: 'spot',
        required: true,
        collectionId: spots.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
      new SelectField({
        id: 'vot_direction',
        name: 'direction',
        required: true,
        maxSelect: 1,
        // A select rather than ±1: no NumberField constraint says "not
        // zero". Retracting deletes the row. Must match `VoteDirection` in
        // `src/api/votes.ts`.
        values: ['up', 'down'],
      }),
      new AutodateField({ name: 'created', onCreate: true }),
      new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }),
    );

    app.save(votes);

    // The tallies, open to a guest. A view collection carries no realtime
    // feed, and a spot with no votes is absent rather than present at zero.
    const scores = new Collection({
      id: 'pbc_spot_scores',
      name: 'spotScores',
      type: 'view',
      listRule: '',
      viewRule: '',
      viewQuery: [
        'SELECT spot AS id, spot,',
        '       COUNT(*) AS votes,',
        "       SUM(CASE WHEN direction = 'up' THEN 1 ELSE 0 END) AS up,",
        "       SUM(CASE WHEN direction = 'down' THEN 1 ELSE 0 END) AS down,",
        "       SUM(CASE WHEN direction = 'up' THEN 1 ELSE -1 END) AS score",
        'FROM votes GROUP BY spot',
      ].join('\n'),
    });

    app.save(scores);
  },
  (app) => {
    // The view reads `votes`, so it goes first.
    try {
      app.delete(app.findCollectionByNameOrId('spotScores'));
    } catch (_) {
      /* already gone */
    }
    try {
      app.delete(app.findCollectionByNameOrId('votes'));
    } catch (_) {
      /* already gone */
    }
  },
);
