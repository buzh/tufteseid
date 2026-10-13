import { transform } from 'ol/proj';

import type { ProjectionIdentifier } from '../map/projections/types';
import {
  nearbyPlaces,
  PLACE_RADIUS_M,
  tellingPlace,
  type NearbyPlace,
} from '../search/placeNames';
import {
  getCadastreAtPoint,
  getElevation,
  getMunicipalityAtPoint,
  getPlaceNamesByLocation,
} from '../search/searchApi';
import type { CadastralTeig, MunicipalityPoint } from '../types/searchTypes';

const MAX_PLACES = 8;

export type PlaceReading = {

  coordinate: [number, number];
  lonLat: [number, number];

  utm33: [number, number];

  busy: boolean;
  metresAboveSea: number | null;
  municipality: MunicipalityPoint | null;

  cadastre: string | null;
  telling: NearbyPlace | null;
  places: NearbyPlace[];
};

export const placeAt = (
  coordinate: [number, number],
  view: ProjectionIdentifier,
): PlaceReading => ({
  coordinate,
  lonLat: transform(coordinate, view, 'EPSG:4326') as [number, number],
  utm33: transform(coordinate, view, 'EPSG:25833') as [number, number],
  busy: true,
  metresAboveSea: null,
  municipality: null,
  cadastre: null,
  telling: null,
  places: [],
});

const matrikkelOf = (teiger: CadastralTeig[]): string | null => {
  const teig = teiger.find((t) => t.hovedområde) ?? teiger[0];
  if (!teig) return null;
  return `${teig.kommunenummer}-${teig.matrikkelnummertekst}`;
};

export const readPlaceAt = async (
  base: PlaceReading,
  signal: AbortSignal,
): Promise<PlaceReading> => {
  const [east, north] = base.utm33;

  const [metresAboveSea, municipality, cadastre, names] = await Promise.all([
    getElevation(east, north, 'EPSG:25833', signal).catch(() => null),
    getMunicipalityAtPoint(east, north, signal).catch(() => null),
    getCadastreAtPoint(east, north, signal).catch(() => null),
    getPlaceNamesByLocation(
      east,
      north,
      PLACE_RADIUS_M,
      'EPSG:25833',
      signal,
    ).catch(() => null),
  ]);

  const points = names?.navn ?? [];

  const telling = tellingPlace(points);

  return {
    ...base,
    busy: false,
    metresAboveSea,
    municipality,
    cadastre: matrikkelOf(
      (cadastre?.features ?? []).map((feature) => feature.properties),
    ),
    telling,
    places: nearbyPlaces(points)
      .filter((place) => place.key !== telling?.key)
      .slice(0, MAX_PLACES),
  };
};

export const readingIsEmpty = (reading: PlaceReading): boolean =>
  reading.metresAboveSea === null &&
  reading.municipality === null &&
  reading.cadastre === null &&
  reading.telling === null;
