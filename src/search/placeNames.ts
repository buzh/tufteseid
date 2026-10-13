import type { ProjectionIdentifier } from '../map/projections/types';
import type { PlaceNamePoint } from '../types/searchTypes';
import { getPlaceNamesByLocation } from './searchApi';

const NAME_TYPE_DENY = new Set([
  'Administrativ bydel',
  'Annen administrativ inndeling',
  'Eiendom',
  'Eiendomsteig',
  'Fylke',
  'Grunnkrets',
  'Havområde',
  'Kommune',
  'Kontinentalsokkel',
  'Matrikkeladressenavn',
  'Nasjon',
  'Poststed',
  'Reinbeitedistrikt',
  'Sjøstykke',
  'Skolekrets',
  'Sokn',
  'Soneinndeling til havs',
  'Statistisk tettsted',
  'Valgkrets',
]);

const NAME_TYPE_PROMOTE = new Set([
  'Bruk',
  'Gammel bosettingsplass',
  'Gard',
  'Grend',
  'Grotte',
  'Heller',
  'Historisk bosetting',
  'Navnegard',
  'Offersted',
  'Seter/støl',
  'Setervoll',
  'Støls-/setereiendom',
  'Tuft',
  'Varde',
]);

const NAME_TYPE_DEMOTE = new Set([
  'Adressenavn',
  'Adressetilleggsnavn',
  'Alpinanlegg',
  'Ankringsplass',
  'Annen bygning for religionsutøvelse',
  'Annen industri- og lagerbygning',
  'Annen kulturdetalj',
  'Badeplass',
  'Bakke (Veg)',
  'Banestrekning',
  'Barnehage',
  'Boinstitusjon',
  'Boligblokk',
  'Boligfelt',
  'Bomstasjon',
  'Borettslag',
  'Bru',
  'Brygge',
  'Busstasjon',
  'Busstopp',
  'Bygg for jordbruk, fiske og fangst',
  'Båke',
  'Campingplass',
  'Dam',
  'Enebolig/mindre boligbygg',
  'Fabrikk',
  'Farled/skipslei',
  'Fengsel',
  'Ferjekai',
  'Ferjestrekning',
  'Fjellheis',
  'Flyplass',
  'Fløtningsanlegg',
  'Fornøyelsespark',
  'Forretningsbygg',
  'Forsamlingshus/kulturhus',
  'Forskningsstasjon',
  'Fritidsbolig',
  'Fyllplass',
  'Fyrlykt',
  'Fyrstasjon',
  'Garasje/hangarbygg',
  'Gjerde',
  'Grensemerke',
  'Grind',
  'Grustak/steinbrudd',
  'Grøft',
  'Havn',
  'Helikopterlandingsplass',
  'Helseinstitusjon',
  'Holdeplass',
  'Hotell',
  'Hyttefelt',
  'Idrettsanlegg',
  'Idrettshall',
  'Industriområde',
  'Jernbanebru',
  'Jernbanetunnel',
  'Jernstang',
  'Kabel',
  'Kai',
  'Kanal',
  'Klopp',
  'Kraftgate (rørgate)',
  'Kraftledning',
  'Kraftstasjon',
  'Kultur-/messehall',
  'Landingsplass',
  'Lanterne',
  'Lysbøye',
  'Militært bygg/anlegg',
  'Mindre brukonstruksjon',
  'Molo',
  'Museum/galleri/bibliotek',
  'Oljeinstallasjon',
  'Oppdrettsanlegg',
  'Overbygg',
  'Overett',
  'Park',
  'Parkeringsplass',
  'Pensjonat',
  'Rasteplass',
  'Rådhus',
  'Rørledning',
  'Serveringssted',
  'Sjømerke med indirekte belysning',
  'Sjøvarde',
  'Skiheis',
  'Skole',
  'Skytebane',
  'Skytefelt',
  'Sluse',
  'Småbåthavn',
  'Stake',
  'Stasjon',
  'Sti',
  'Sykehus',
  'TV-/radio- eller mobiltelefontårn',
  'Taubane',
  'Torg',
  'Torvtak',
  'Traktorveg',
  'Tunnel',
  'Turisthytte',
  'Tømmervelte',
  'Universitet/høgskole',
  'Vaktstasjon/beredsskapsbygning',
  'Vannstandsmåler',
  'Vannverk',
  'Vegbom',
  'Vegkryss',
  'Vegstrekning',
  'Vegsving',
]);

const PROMOTE_BONUS_M = 400;

const DEMOTE_PENALTY_M = 1000000;

const SETTLED_SPELLING = new Set([
  'godkjent',
  'godkjent og prioritert',
  'vedtatt',
  'vedteke',
]);

export const PLACE_RADIUS_M = 600;

export type NearbyPlace = {
  key: string;
  name: string;

  kind: string;
  metres: number;
};

const spellingOf = (point: PlaceNamePoint): string => {
  const names = point.stedsnavn;
  const chosen =
    names.find((n) => n.navnestatus === 'hovednavn') ??
    names.find((n) => SETTLED_SPELLING.has(n.skrivemåtestatus)) ??
    names[0];
  return chosen?.skrivemåte?.trim() ?? '';
};

const scored = (
  points: PlaceNamePoint[],
): { place: NearbyPlace; score: number }[] => {
  const out: { place: NearbyPlace; score: number }[] = [];

  for (const point of points) {
    if (point.stedstatus !== 'aktiv') continue;

    const kind = point.navneobjekttype.trim();
    if (NAME_TYPE_DENY.has(kind)) continue;

    const name = spellingOf(point);
    if (!name) continue;

    out.push({
      place: {
        key: String(point.stedsnummer),
        name,
        kind,
        metres: point.meterFraPunkt,
      },
      score:
        point.meterFraPunkt -
        (NAME_TYPE_PROMOTE.has(kind) ? PROMOTE_BONUS_M : 0) +
        (NAME_TYPE_DEMOTE.has(kind) ? DEMOTE_PENALTY_M : 0),
    });
  }

  return out;
};

export const nearbyPlaces = (points: PlaceNamePoint[]): NearbyPlace[] =>
  scored(points)
    .sort((a, b) => a.place.metres - b.place.metres)
    .map((entry) => entry.place);

export const tellingPlace = (points: PlaceNamePoint[]): NearbyPlace | null =>
  scored(points).sort((a, b) => a.score - b.score)[0]?.place ?? null;

export const suggestPlaceName = async (
  x: number,
  y: number,
  projection: ProjectionIdentifier,
): Promise<string> => {
  try {
    const response = await getPlaceNamesByLocation(
      x,
      y,
      PLACE_RADIUS_M,
      projection,
    );
    return tellingPlace(response.navn ?? [])?.name ?? '';
  } catch {
    return '';
  }
};
