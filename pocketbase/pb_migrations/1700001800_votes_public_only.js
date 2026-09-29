/// <reference path="../pb_data/types.d.ts" />
//
// `1700001700_spot_votes.js` gated voting on a public spot at create time
// only, which two ordinary sequences walk straight past: a vote PATCHed onto
// a private spot's id, and a spot its owner turns private after it has been
// voted on. Either way the tally stayed listable by a guest. So the gate is
// re-asserted on update, the relations are pinned so only `direction` moves,
// and the view joins `spots` rather than trusting the rows under it.

const OWN_RULE = 'owner = @request.auth.id || @request.auth.role = "admin"';

const PUBLIC_UPDATE_RULE = [
  `(${OWN_RULE})`,
  'spot.visibility = "public"',
  // The vote may change its mind, not its spot or its owner.
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
