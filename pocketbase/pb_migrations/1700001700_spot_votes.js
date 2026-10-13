/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const spots = app.findCollectionByNameOrId('spots');

    const ownRule = 'owner = @request.auth.id || @request.auth.role = "admin"';

    const votes = new Collection({
      id: 'pbc_votes',
      name: 'votes',
      type: 'base',
      listRule: ownRule,
      viewRule: ownRule,
      createRule:
        '@request.auth.id != "" && @request.auth.id = owner && ' +
        'spot.visibility = "public"',
      updateRule: ownRule,
      deleteRule: ownRule,
      indexes: [
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
        values: ['up', 'down'],
      }),
      new AutodateField({ name: 'created', onCreate: true }),
      new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }),
    );

    app.save(votes);

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
    try {
      app.delete(app.findCollectionByNameOrId('spotScores'));
    } catch (_) {
    }
    try {
      app.delete(app.findCollectionByNameOrId('votes'));
    } catch (_) {
    }
  },
);
