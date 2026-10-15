/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const settings = app.settings();

    unmarshal(
      {
        trustedProxy: { headers: ['X-Forwarded-For'], useLeftmostIP: false },
        rateLimits: {
          enabled: true,
          rules: [
            { label: '*:auth', maxRequests: 2, duration: 3 },
            { label: '/api/flyfoto-gate', maxRequests: 120, duration: 10 },
            { label: '/api/batch', maxRequests: 3, duration: 1 },
            { label: 'spots:create', maxRequests: 30, duration: 60 },
            { label: 'evidence:create', maxRequests: 120, duration: 60 },
            { label: '*:create', maxRequests: 20, duration: 5 },
            {
              label: '/api/',
              maxRequests: 100,
              duration: 10,
              audience: '@guest',
            },
            { label: '/api/', maxRequests: 300, duration: 10 },
          ],
        },
      },
      settings,
    );

    app.save(settings);
  },
  (app) => {
    const settings = app.settings();

    unmarshal(
      {
        trustedProxy: { headers: [], useLeftmostIP: false },
        rateLimits: { enabled: false },
      },
      settings,
    );

    app.save(settings);
  },
);
