type layerProviderParameters = {
  kartverketCache: {
    baseUrl: string;
  };
};

type Env = {
  apiUrl: string;
  geoNorgeApiBaseUrl: string;
  // Same-origin path proxied by Caddy → pocketbase container. Overridable
  // for local `vite dev` where the SPA runs on :5173 and PB on :8090.
  pocketbaseUrl: string;
  layerProviderParameters: layerProviderParameters;
};

// Compiled-in defaults. Every field is overridable at runtime from
// config.js at the repo root, which is why there's one table here
// rather than a per-environment set keyed off the hostname.
const DEFAULT_ENV: Env = {
  apiUrl: 'https://api.norgeskart.no',
  geoNorgeApiBaseUrl: 'https://ws.geonorge.no',
  pocketbaseUrl: '/pb',
  layerProviderParameters: {
    kartverketCache: {
      baseUrl: 'https://cache.kartverket.no',
    },
  },
};

declare global {
  interface Window {
    __NK_CONFIG__?: Partial<Env> & {
      layerProviderParameters?: Partial<layerProviderParameters>;
    };
  }
}

const getEnv = (): Env => {
  const override =
    typeof window !== 'undefined' ? window.__NK_CONFIG__ : undefined;
  if (!override) return DEFAULT_ENV;
  return {
    ...DEFAULT_ENV,
    ...override,
    layerProviderParameters: {
      ...DEFAULT_ENV.layerProviderParameters,
      ...(override.layerProviderParameters ?? {}),
    },
  };
};

export { getEnv };
