/// <reference path="../pb_data/types.d.ts" />

onRecordAuthRequest((e) => {
  const capacity = require(`${__hooks}/capacity.js`);
  capacity.admitQueued(e.app, e.record);
  e.next();
}, 'users');

routerAdd('GET', '/api/capacity', (e) => {
  const capacity = require(`${__hooks}/capacity.js`);
  return e.json(200, capacity.state(e.app));
});
