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
  /** x, y in `projection` — easting and northing where that is what it is. */
  at: [number, number];
  projection: ProjectionIdentifier;
  /** Floor for the view: a hit never zooms a closer reader out. */
  zoom: number;
};

export const MIN_QUERY_LENGTH = 2;

const DEBOUNCE_MS = 250;

const PLACE_ZOOM = 14;
const ADDRESS_ZOOM = 16;
const COORDINATE_ZOOM = 16;

// Geonorge answers both in ETRS89, which is WGS84 at display precision.
const GEONORGE_PROJECTION: ProjectionIdentifier = 'EPSG:4326';

const placeHit = (place: PlaceName, index: number): SearchHit => ({
  // Not `stedsnummer`: one place answers once per spelling it is known by.
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
    // A projected pair is read as easting and northing under these names.
    at: [parsed.lon, parsed.lat],
    projection: parsed.projection,
    zoom: COORDINATE_ZOOM,
  };
};

/**
 * Places, addresses and a typed coordinate for `query`, debounced. What the
 * last answer was asked for is kept with it, so a query still being typed
 * reads as busy over the previous list rather than emptying the box.
 */
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

  // A query being refined keeps the list it is narrowing; one started afresh
  // does not hold the last reader's hits up as if they were an answer.
  const standing =
    answer && needle.startsWith(answer.needle) ? answer.hits : [];

  return {
    hits: ready ? standing : [],
    busy: ready && answer?.needle !== needle,
  };
};
