import { useEffect, useState } from 'react';
import type { ProjectionIdentifier } from '../map/projections/types';
import { parseCoordinateInput } from '../shared/utils/coordinateParser';
import type { Address, PlaceName } from '../types/searchTypes';
import type { MaterialSymbol } from '../ui/Icon';
import { getAddresses, getPlaceNames, normalizePlaceQuery } from './searchApi';

export type SearchHitKind = 'coordinate' | 'place' | 'address';

export type SearchHit = {
  key: string;
  kind: SearchHitKind;
  name: string;
  detail: string;
  icon: MaterialSymbol;
  at: [number, number];
  projection: ProjectionIdentifier;
  zoom: number;
};

export const MIN_QUERY_LENGTH = 2;

const DEBOUNCE_MS = 250;

const PLACE_ZOOM = 14;
const ADDRESS_ZOOM = 16;
const COORDINATE_ZOOM = 16;

const GEONORGE_PROJECTION: ProjectionIdentifier = 'EPSG:4326';

const placeHit = (place: PlaceName, index: number): SearchHit => ({
  key: `place-${index}`,
  kind: 'place',
  name: place.skrivemåte,
  detail: [
    place.kommuner.map((municipality) => municipality.kommunenavn).join(', '),
    place.navneobjekttype,
  ]
    .filter(Boolean)
    .join(' · '),
  icon: 'location_on',
  at: [place.representasjonspunkt.øst, place.representasjonspunkt.nord],
  projection: GEONORGE_PROJECTION,
  zoom: PLACE_ZOOM,
});

const addressHit = (address: Address, index: number): SearchHit => ({
  key: `address-${index}`,
  kind: 'address',
  name: address.adressetekst,
  detail: [address.postnummer, address.poststed].filter(Boolean).join(' '),
  icon: 'home_pin',
  at: [address.representasjonspunkt.lon, address.representasjonspunkt.lat],
  projection: GEONORGE_PROJECTION,
  zoom: ADDRESS_ZOOM,
});

const coordinateHit = (query: string): SearchHit | null => {
  const parsed = parseCoordinateInput(query);
  if (!parsed) return null;
  return {
    key: 'coordinate',
    kind: 'coordinate',
    name: parsed.formattedString,
    detail: parsed.projection,
    icon: 'my_location',
    at: [parsed.lon, parsed.lat],
    projection: parsed.projection,
    zoom: COORDINATE_ZOOM,
  };
};

export const useSearch = (query: string) => {
  const [answer, setAnswer] = useState<{
    needle: string;
    hits: SearchHit[];
  } | null>(null);

  const needle = query.trim();
  const ready = needle.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (needle.length < MIN_QUERY_LENGTH) return;

    const coordinate = coordinateHit(needle);
    let live = true;

    const timer = window.setTimeout(() => {
      const places = normalizePlaceQuery(needle)
        ? getPlaceNames(needle, 1)
        : Promise.resolve(null);
      Promise.all([places, getAddresses(needle)]).then(
        ([placeNames, addresses]) => {
          if (!live) return;
          setAnswer({
            needle,
            hits: [
              ...(coordinate ? [coordinate] : []),
              ...(placeNames?.navn ?? []).map(placeHit),
              ...addresses.adresser.map(addressHit),
            ],
          });
        },
      );
    }, DEBOUNCE_MS);

    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [needle]);

  const standing =
    answer && needle.startsWith(answer.needle) ? answer.hits : [];

  return {
    hits: ready ? standing : [],
    busy: ready && answer?.needle !== needle,
  };
};
