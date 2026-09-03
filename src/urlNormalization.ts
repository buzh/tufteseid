import { transitionHashToQuery } from './shared/utils/urlUtils.ts';

// Runs before React mounts (see main.tsx): migrates hash-fragment URLs
// (`#lat=…&lon=…`) to the query string.
export const processUrlParameters = () => {
  transitionHashToQuery();
};
