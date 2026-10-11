/// <reference path="../pb_data/types.d.ts" />
//
// The cap on how many accounts hold a place, enforced at sign-in and
// published to the surfaces that offer one (`docs/identity.md`).
//
// Which role a *new* row gets is `identity.pb.js`'s half, because that runs
// inside the transaction the closed beta's create is wrapped in and this
// does not.
//
// Every handler runs in a runtime of its own and cannot see this file's
// scope, so each one requires `capacity.js`, which is where the logic lives.

// Every way of holding a token comes through here — a password sign-in and
// an `authRefresh` alike — so a queued account cannot carry one by any route,
// and the page that was left open signs itself out on its next refresh.
onRecordAuthRequest((e) => {
  const capacity = require(`${__hooks}/capacity.js`);
  capacity.admitQueued(e.app, e.record);
  e.next();
}, 'users');

// How full the installation is, open to a guest: the sign-in box says it
// before the reader fills the form in, and the invite panel before they spend
// a code on somebody who would only be queued.
routerAdd('GET', '/api/capacity', (e) => {
  const capacity = require(`${__hooks}/capacity.js`);
  return e.json(200, capacity.state(e.app));
});
