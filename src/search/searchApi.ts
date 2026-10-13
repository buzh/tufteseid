import { transform } from 'ol/proj';
import { getEnv } from '../env.ts';
import { ProjectionIdentifier } from '../map/projections/types.ts';
import { fetchWithin } from '../shared/utils/deadline.ts';
import { isNumberOk } from '../shared/utils/numberUtils.ts';
import {
  AddressApiResponse,
  CadastreApiResponse,
  MunicipalityPoint,
  PlaceNameApiResponse,
  PlaceNamePointApiResponse,
  Property,
  Road,
} from '../types/searchTypes.ts';

const env = getEnv();

const normalizeAddressQuery = (query: string): string =>
  query.replace(/\s+/g, ' ').trim();

const isInvalidAddressSearch = (query: string): boolean => {
  const q = query.trim().toLowerCase();

  const directionWithNumber =
    /^(nord|sør|øst|vest|north|south|east|west|n|s|e|w)\s*[:\s]\s*\d+/i;

  const latLonLike = /-?\d{1,3}\.\d+\s*,?\s*-?\d{1,3}\.\d+/;

  return directionWithNumber.test(q) || latLonLike.test(q);
};

const ADDRESS_SEARCH_PAGE_SIZE = 8;
const PLACE_SEARCH_PAGE_SIZE = 8;

const POINT_DEADLINE_MS = 8000;

const emptyAddressResult = (query: string): AddressApiResponse => ({
  adresser: [],
  metadata: {
    side: 1,
    totaltAntallTreff: 0,
    treffPerSide: ADDRESS_SEARCH_PAGE_SIZE,
    viserFra: 0,
    viserTil: 0,
    sokeStreng: query,
    utkoordsys: 4258,
  },
});

export const getAddresses = async (
  query: string,
): Promise<AddressApiResponse> => {
  try {
    const normalizedQuery = normalizeAddressQuery(query);
    if (isInvalidAddressSearch(normalizedQuery)) {
      return emptyAddressResult(query);
    }
    const encodedQuery = encodeURIComponent(normalizedQuery);
    const url = `${env.geoNorgeApiBaseUrl}/adresser/v1/sok?sok=${encodedQuery}&treffPerSide=${ADDRESS_SEARCH_PAGE_SIZE}`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(
        `API failed [addresses]: ${res.status} for "${query}", Statuscode:${res.status}`,
      );
    }
    return res.json();
  } catch (error) {
    console.error(error);
    return emptyAddressResult(query);
  }
};

export const normalizePlaceQuery = (input: string) => {
  const cleaned = input
    .replace(/["]/g, '')
    .replace(/^\s*,+/, '')
    .replace(/[?\\*;%]/g, '')
    .trim();

  if (!cleaned) return null;

  const [searchPart, municipalityPart] = cleaned
    .split(',')
    .map((p) => p?.trim());

  if (!searchPart) return null;

  return {
    searchPart,
    municipalityPart,
  };
};

export const getPlaceNames = async (
  query: string,
  page: number,
): Promise<PlaceNameApiResponse> => {
  const normalized = normalizePlaceQuery(query);

  const url = new URL(`${env.geoNorgeApiBaseUrl}/stedsnavn/v1/navn`);
  url.searchParams.append('sok', `${normalized?.searchPart}*`);
  if (normalized?.municipalityPart) {
    url.searchParams.append('kommunenavn', `${normalized?.municipalityPart}*`);
  }
  url.searchParams.append('treffPerSide', PLACE_SEARCH_PAGE_SIZE.toString());
  url.searchParams.append('side', page.toString());
  url.searchParams.append('fuzzy', 'true');
  url.searchParams.append('utkoordsys', '4258');

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(
        `API failed [placeNames]: ${res.status} for "${query}", Statuscode:${res.status}`,
      );
    }
    return res.json();
  } catch (error) {
    console.error(error);

    return {
      navn: [],
      metadata: {
        side: page,
        totaltAntallTreff: 0,
        treffPerSide: PLACE_SEARCH_PAGE_SIZE,
        viserFra: 0,
        viserTil: 0,
        sokeStreng: query,
        utkoordsys: 4258,
      },
    };
  }
};

export const getPlaceNamesByLocation = async (
  x: number,
  y: number,
  radius: number,
  projection: ProjectionIdentifier,
  signal?: AbortSignal,
): Promise<PlaceNamePointApiResponse> => {
  const projectionEPSGNumber = projection.split(':')[1];
  const url = `${env.geoNorgeApiBaseUrl}/stedsnavn/v1/punkt?nord=${y}&ost=${x}&treffPerSide=35&koordsys=${projectionEPSGNumber}&radius=${radius}&side=1`;

  return fetchWithin(
    url,
    { ms: POINT_DEADLINE_MS, what: 'stedsnavn', signal },
    (res) => res.json() as Promise<PlaceNamePointApiResponse>,
  );
};

export const getRoads = async (query: string): Promise<Road[]> => {
  const url = `${env.apiUrl}/v1/matrikkel/veg/${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `API failed [roads]: ${res.status} for "${query}", Statuscode:${res.status}`,
      );
    }
    return res.json();
  } catch (error) {
    console.error(error);
    return [];
  }
};

const SLASH_ONLY_PATTERN = /^(\d{4})\/(\d{1,5})\/(\d{1,5})(\/\d{1,5})?$/;

const normalizePropertyQuery = (query: string): string => {
  const match = query.match(SLASH_ONLY_PATTERN);

  if (match) {
    const kommunenr = match[1];
    const gnr = match[2];
    const bnr = match[3];
    const festenr = match[4] || '';

    return `${kommunenr}-${gnr}/${bnr}${festenr}`;
  }

  return query;
};

export const getProperties = async (query: string): Promise<Property[]> => {
  const normalizedQuery = normalizePropertyQuery(query);
  const encodedQuery = encodeURIComponent(normalizedQuery);
  const url = `${env.apiUrl}/v1/matrikkel/eie/${encodedQuery}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `API failed [properties]: ${res.status} for "${query}", Statuscode:${res.status}`,
      );
    }
    return res.json();
  } catch (error) {
    console.error(error);
    return [];
  }
};

export const getElevation = async (
  x: number,
  y: number,
  srs: ProjectionIdentifier,
  signal?: AbortSignal,
): Promise<number | null> => {
  if (!isNumberOk(x) || !isNumberOk(y)) return null;
  const [east, north] = transform([x, y], srs, 'EPSG:25833');

  const query = new URLSearchParams({
    f: 'json',
    geometry: `${east},${north}`,
    geometryType: 'esriGeometryPoint',
    sr: '25833',
    returnGeometry: 'false',
    returnCatalogItems: 'false',
  });

  const answer = await fetchWithin(
    `/arcgis/hoydedata/NHM_DTM_25833/ImageServer/identify?${query}`,
    { ms: POINT_DEADLINE_MS, what: 'elevation', signal },
    (res) => res.json() as Promise<{ value?: string }>,
  );

  const metres = Number(answer.value);
  return isNumberOk(metres) ? metres : null;
};

export const getMunicipalityAtPoint = async (
  east: number,
  north: number,
  signal?: AbortSignal,
): Promise<MunicipalityPoint> => {
  const query = new URLSearchParams({
    nord: north.toString(),
    ost: east.toString(),
    koordsys: '25833',
  });

  return fetchWithin(
    `${env.geoNorgeApiBaseUrl}/kommuneinfo/v1/punkt?${query}`,
    { ms: POINT_DEADLINE_MS, what: 'kommuneinfo', signal },
    (res) => res.json() as Promise<MunicipalityPoint>,
  );
};

export const getCadastreAtPoint = async (
  east: number,
  north: number,
  signal?: AbortSignal,
): Promise<CadastreApiResponse> => {
  const query = new URLSearchParams({
    radius: '1',
    nord: north.toString(),
    ost: east.toString(),
    koordsys: '25833',
  });

  return fetchWithin(
    `${env.geoNorgeApiBaseUrl}/eiendom/v1/punkt/omrader?${query}`,
    { ms: POINT_DEADLINE_MS, what: 'matrikkel', signal },
    (res) => res.json() as Promise<CadastreApiResponse>,
  );
};

export const getPropertyDetailsByMatrikkelId = async (
  kommunenr: string,
  gardsnr: string,
  bruksnr: string,
  festenr: string = '0',
  seksjonsnr: string = '0',
) => {
  const isNumeric = (value: string) => /^\d+$/.test(value);

  if (
    !isNumeric(kommunenr) ||
    !isNumeric(gardsnr) ||
    !isNumeric(bruksnr) ||
    !isNumeric(festenr) ||
    !isNumeric(seksjonsnr)
  ) {
    throw new Error('Alle parametere må være numeriske verdier.');
  }

  let url = `${env.apiUrl}/v1/matrikkel/eiendom/`;
  if (festenr !== '0') {
    if (seksjonsnr === '0') {
      url += `${kommunenr}-${gardsnr}/${bruksnr}/${festenr}`;
    } else {
      url += `${kommunenr}-${gardsnr}/${bruksnr}/${festenr}/${seksjonsnr}`;
    }
  } else {
    url += `${kommunenr}-${gardsnr}/${bruksnr}`;
  }
  url += `&KILDE:Eiendom KOMMUNENR:${kommunenr} GARDSNR:${gardsnr} BRUKSNR:${bruksnr} SEKSJONSNR:${seksjonsnr} FESTENR:${festenr}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `API failed [propertyDetailsByMatrikkelId]: ${res.status} for matrikkelId (${kommunenr}-${gardsnr}/${bruksnr}/${festenr}/${seksjonsnr}), Statuscode:${res.status}`,
      );
    }
    return res.json();
  } catch (error) {
    console.error(error);
    throw error;
  }
};
