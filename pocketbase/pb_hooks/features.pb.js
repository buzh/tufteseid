/// <reference path="../pb_data/types.d.ts" />

routerAdd(
  'GET',
  '/api/flyfoto-gate',
  (e) => {
    const features = require(`${__hooks}/features.js`);

    if (!features.holds(e.auth, 'flyfoto')) {
      throw new ForbiddenError('Flyfoto er ikke slått på for denne kontoen.');
    }

    return e.json(200, { flyfoto: true });
  },
  $apis.requireAuth('users'),
);
