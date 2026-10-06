/// <reference path="../pb_data/types.d.ts" />
//
// Nobody ranks their own spot. Only create carries the rule: update already
// pins `spot` and `owner`, so no existing vote can turn into a self-vote.
// Self-votes cast before this keep their row and stop counting, the trade
// `1700001800_votes_public_only.js` already made for a spot turned private.

const CREATE_RULE = [
  '@request.auth.id != ""',
  '@request.auth.id = owner',
  'spot.visibility = "public"',
  'spot.owner != @request.auth.id',
].join(' && ');

const OLD_CREATE_RULE = [
  '@request.auth.id != ""',
  '@request.auth.id = owner',
  'spot.visibility = "public"',
].join(' && ');

const VIEW_QUERY = [
  'SELECT v.spot AS id, v.spot AS spot,',
  '       COUNT(*) AS votes,',
  "       SUM(CASE WHEN v.direction = 'up' THEN 1 ELSE 0 END) AS up,",
  "       SUM(CASE WHEN v.direction = 'down' THEN 1 ELSE 0 END) AS down,",
  "       SUM(CASE WHEN v.direction = 'up' THEN 1 ELSE -1 END) AS score",
  'FROM votes v JOIN spots s ON s.id = v.spot',
  "WHERE s.visibility = 'public' AND v.owner != s.owner",
  'GROUP BY v.spot',
].join('\n');

const OLD_VIEW_QUERY = [
  'SELECT v.spot AS id, v.spot AS spot,',
  '       COUNT(*) AS votes,',
  "       SUM(CASE WHEN v.direction = 'up' THEN 1 ELSE 0 END) AS up,",
  "       SUM(CASE WHEN v.direction = 'down' THEN 1 ELSE 0 END) AS down,",
  "       SUM(CASE WHEN v.direction = 'up' THEN 1 ELSE -1 END) AS score",
  'FROM votes v JOIN spots s ON s.id = v.spot',
  "WHERE s.visibility = 'public'",
  'GROUP BY v.spot',
].join('\n');

migrate(
  (app) => {
    const votes = app.findCollectionByNameOrId('votes');
    votes.createRule = CREATE_RULE;
    app.save(votes);

    const scores = app.findCollectionByNameOrId('spotScores');
    scores.viewQuery = VIEW_QUERY;
    app.save(scores);
  },
  (app) => {
    const votes = app.findCollectionByNameOrId('votes');
    votes.createRule = OLD_CREATE_RULE;
    app.save(votes);

    const scores = app.findCollectionByNameOrId('spotScores');
    scores.viewQuery = OLD_VIEW_QUERY;
    app.save(scores);
  },
);
