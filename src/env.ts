type layerProviderParameters = {
  kartverketCache: {
    baseUrl: string;
  };
};

type Env = {
  apiUrl: string;
  geoNorgeApiBaseUrl: string;
  pocketbaseUrl: string;
  renderUrl: string;
  layerProviderParameters: layerProviderParameters;
};

const DEFAULT_ENV: Env = {
  apiUrl: 'https://api.norgeskart.no',
  geoNorgeApiBaseUrl: 'https://ws.geonorge.no',
  pocketbaseUrl: '/pb',
  renderUrl: '/render',
  layerProviderParameters: {
    kartverketCache: {
      baseUrl: 'https://cache.kartverket.no',
    },
  },
};

declare global {
  interface Window {
    __TUFTESEID_CONFIG__?: Partial<Env> & {
      layerProviderParameters?: Partial<layerProviderParameters>;
    };
  }
}

const getEnv = (): Env => {
  const override =
    typeof window !== 'undefined' ? window.__TUFTESEID_CONFIG__ : undefined;
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
