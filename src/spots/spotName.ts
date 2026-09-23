import type { PlaceNamePoint } from '../types/searchTypes';
import { getPlaceNamesByLocation } from '../search/searchApi';
import type { ProjectionIdentifier } from '../map/projections/types';

// A name suggestion for a new pin, off ws.geonorge.no's stedsnavn register,
// ranked by `navneobjekttype` first and distance second. The three sets below
// are `navneobjekttype` values; anything unlisted is the neutral middle.
//
// Denied: administrative geography.
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

// Promoted by PROMOTE_BONUS_M's worth, not unconditionally.
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

// Demoted, not denied: in a town it may be all there is.
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

// How much nearer a neutral name has to be to beat a promoted one.
const PROMOTE_BONUS_M = 400;

// Bigger than any reachable meterFraPunkt: the demoted tier sorts strictly last.
const DEMOTE_PENALTY_M = 1000000;

// Breaks ties on places with no `hovednavn`, where the first entry is often a
// rejected spelling.
const SETTLED_SPELLING = new Set([
  'godkjent',
  'godkjent og prioritert',
  'vedtatt',
  'vedteke',
]);

const SEARCH_RADIUS_M = 600;

const TIMEOUT_MS = 6000;

/** `hovednavn` if the entry has one, else the first settled spelling, else
 *  whatever came first. */
const spellingOf = (point: PlaceNamePoint): string => {
  const names = point.stedsnavn;
  const chosen =
    names.find((n) => n.navnestatus === 'hovednavn') ??
    names.find((n) => SETTLED_SPELLING.has(n.skrivemåtestatus)) ??
    names[0];
  return chosen?.skrivemåte?.trim() ?? '';
};

const pickPlaceName = (points: PlaceNamePoint[]): string => {
  let bestName = '';
  let bestScore = Number.POSITIVE_INFINITY;

  for (const point of points) {
    if (point.stedstatus !== 'aktiv') continue;

    // The register carries trailing spaces on some type labels.
    const type = point.navneobjekttype.trim();
    if (NAME_TYPE_DENY.has(type)) continue;

    const name = spellingOf(point);
    if (!name) continue;

    const score =
      point.meterFraPunkt -
      (NAME_TYPE_PROMOTE.has(type) ? PROMOTE_BONUS_M : 0) +
      (NAME_TYPE_DEMOTE.has(type) ? DEMOTE_PENALTY_M : 0);

    if (score < bestScore) {
      bestScore = score;
      bestName = name;
    }
  }

  return bestName;
};

/** Never throws and never hangs: every failure, timeout included, is ''. */
export const suggestSpotName = async (
  x: number,
  y: number,
  projection: ProjectionIdentifier,
): Promise<string> => {
  try {
    const response = await Promise.race([
      getPlaceNamesByLocation(x, y, SEARCH_RADIUS_M, projection),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), TIMEOUT_MS),
      ),
    ]);
    if (!response) return '';
    return pickPlaceName(response.navn ?? []);
  } catch {
    return '';
  }
};
