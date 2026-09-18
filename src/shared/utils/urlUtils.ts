const getSearchParams = (): URLSearchParams =>
  new URL(window.location.href).searchParams;

const updateUrl = (
  url: URL,
  updateFn: (params: URLSearchParams) => void,
): void => {
  updateFn(url.searchParams);
  window.history.replaceState({}, '', url.toString());
};

export const setUrlParameter = (
  key: UrlParameter,
  value: string | number | boolean,
): void => {
  const url = new URL(window.location.href);
  updateUrl(url, (params) => params.set(key, String(value)));
};

export const removeUrlParameter = (key: UrlParameter): void => {
  const url = new URL(window.location.href);
  updateUrl(url, (params) => params.delete(key));
};

export const getUrlParameter = (key: UrlParameter): string | null => {
  return getSearchParams().get(key);
};

export const getListUrlParameter = (key: UrlParameter): string[] | null => {
  const param = getSearchParams().get(key);
  if (param) {
    return param.split(',');
  }
  return null;
};

export const addToUrlListParameter = (
  key: UrlParameter,
  value: string | number | boolean,
): void => {
  const param = getSearchParams().get(key);
  const values: string[] = param ? param.split(',') : [];
  const stringValue = String(value);

  if (!values.includes(stringValue)) {
    values.push(stringValue);
    const url = new URL(window.location.href);
    updateUrl(url, (params) => params.set(key, values.join(',')));
  }
};

export const removeFromUrlListParameter = (
  key: UrlParameter,
  value: string | number | boolean,
): void => {
  const param = getSearchParams().get(key);
  if (!param) return;

  const stringValue = String(value);
  const values = param.split(',').filter((v) => v !== stringValue);
  const url = new URL(window.location.href);

  updateUrl(url, (params) => {
    if (values.length === 0) {
      params.delete(key);
    } else {
      params.set(key, values.join(','));
    }
  });
};

export type UrlParameter =
  | 'projection'
  | 'backgroundLayer'
  | 'hybrid'
  | 'contours'
  | 'lidarModel'
  | 'themeLayers'
  | 'heritageDetails'
  | 'heritageRender'
  | 'heritageOpacity'
  | 'lat'
  | 'lon'
  | 'markerLat'
  | 'markerLon'
  | 'zoom'
  | 'sok'
  | 'showSelection'
  // The open lokalitet, as its six-character code, not its PB id; the only
  // parameter here that names a record, and so the only one that can fail to
  // resolve. `src/localities/shareLink.ts` owns both directions.
  | 'lok';
