// Runtime configuration for a self-hosted deployment.
// Copy this file to config.js in the repo root; docker-compose mounts it
// into the container as /var/www/config.js and it is served as /config.js.
//
// Anything you set here overrides the compiled-in defaults from src/env.ts.
// Omit a field to keep the default. Changes take effect on the next page
// load — no rebuild, no restart. See README.md for the full reference.
window.__NK_CONFIG__ = {
  // Kartverket's cadastral (matrikkel) API — property search and property
  // outlines, called from the browser. It reflects the caller's Origin, so
  // it works from a self-hosted site.
  apiUrl: 'https://api.norgeskart.no',

  // Place-name and address search. Public, browser-callable.
  geoNorgeApiBaseUrl: 'https://ws.geonorge.no',

  // Annotations backend (PocketBase). Same-origin path proxied by Caddy
  // to the `pocketbase` compose service. OAuth providers (Google, GitHub,
  // …) are configured in the PB admin UI at `${pocketbaseUrl}/_/`.
  pocketbaseUrl: '/pb',

  layerProviderParameters: {
    // Topographic base map tiles, fetched by the browser directly.
    kartverketCache: { baseUrl: 'https://cache.kartverket.no' },
  },
};
