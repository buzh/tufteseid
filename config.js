// Runtime configuration, served to the browser as /config.js and read
// before the SPA starts. The defaults below work as-is; see the
// Configuration section of README.md for what each key does. Edits take
// effect on the next page load — no rebuild, no restart.
window.__NK_CONFIG__ = {
  apiUrl: 'https://api.norgeskart.no',
  geoNorgeApiBaseUrl: 'https://ws.geonorge.no',
  pocketbaseUrl: '/pb',
  layerProviderParameters: {
    kartverketCache: { baseUrl: 'https://cache.kartverket.no' },
  },
};
