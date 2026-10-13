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

export type UrlParameter =
  | 'lok'
  | 'invite'
  | 'projection'
  | 'backgroundLayer'
  | 'hybrid'
  | 'contours'
  | 'lidarModel'
  | 'lidarRender'
  | 'viewMode'
  | 'backgroundLayerB'
  | 'curtain'
  | 'themeLayers'
  | 'heritageDetails'
  | 'heritageRender'
  | 'heritageOpacity'
  | 'sketches'
  | 'lat'
  | 'lon'
  | 'zoom';
