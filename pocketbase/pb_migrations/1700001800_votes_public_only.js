/// <reference path="../pb_data/types.d.ts" />

const OWN_RULE = 'owner = @request.auth.id || @request.auth.role = "admin"';

const PUBLIC_UPDATE_RULE = [
  `(${OWN_RULE})`,
  'spot.visibility = "public"',
  '(@request.body.spot:isset = false || @request.body.spot = spot)',
  '(@request.body.owner:isset = false || @request.body.owner = owner)',
].join(' && ');

const PUBLIC_VIEW_QUERY = [
  'SELECT v.spot AS id, v.spot AS spot,',
  '       COUNT(*) AS votes,',
  "       SUM(CASE WHEN v.direction = 'up' THEN 1 ELSE 0 END) AS up,",
  "       SUM(CASE WHEN v.direction = 'down' THEN 1 ELSE 0 END) AS down,",
  "       SUM(CASE WHEN v.direction = 'up' THEN 1 ELSE -1 END) AS score",
  'FROM votes v JOIN spots s ON s.id = v.spot',
  "WHERE s.visibility = 'public'",
  'GROUP BY v.spot',
].join('\n');

const OLD_VIEW_QUERY = [
  'SELECT spot AS id, spot,',
  '       COUNT(*) AS votes,',
  "       SUM(CASE WHEN direction = 'up' THEN 1 ELSE 0 END) AS up,",
  "       SUM(CASE WHEN direction = 'down' THEN 1 ELSE 0 END) AS down,",
  "       SUM(CASE WHEN direction = 'up' THEN 1 ELSE -1 END) AS score",
  'FROM votes GROUP BY spot',
].join('\n');

migrate(
  (app) => {
    const votes = app.findCollectionByNameOrId('votes');
    votes.updateRule = PUBLIC_UPDATE_RULE;
    app.save(votes);

    const scores = app.findCollectionByNameOrId('spotScores');
    scores.viewQuery = PUBLIC_VIEW_QUERY;
    app.save(scores);
  },
  (app) => {
    const votes = app.findCollectionByNameOrId('votes');
    votes.updateRule = OWN_RULE;
    app.save(votes);

    const scores = app.findCollectionByNameOrId('spotScores');
    scores.viewQuery = OLD_VIEW_QUERY;
    app.save(scores);
  },
);
