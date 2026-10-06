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
  // The open spot's six-character code, not its PocketBase id.
  | 'lok'
  // An invite code to the closed beta. Read at boot by
  // `src/invites/inviteLink.ts` and dropped by the sign-in box, which is the
  // only place it can be spent.
  | 'invite'
  | 'projection'
  | 'backgroundLayer'
  | 'hybrid'
  | 'contours'
  | 'lidarModel'
  // Which LiDAR render. Not derivable from `backgroundLayer`: the two flight
  // grounds are named for cVAT or not-cVAT, and the mosaic's name says nothing
  // at all.
  | 'lidarRender'
  | 'themeLayers'
  | 'heritageDetails'
  | 'heritageRender'
  | 'heritageOpacity'
  // Every spot's chosen drawing on the ground at once.
  | 'sketches'
  | 'lat'
  | 'lon'
  | 'zoom';
