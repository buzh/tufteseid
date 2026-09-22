import type { PlaceNamePoint } from '../types/searchTypes';
import { getPlaceNamesByLocation } from '../search/searchApi';
import type { ProjectionIdentifier } from '../map/projections/types';

// What to call a spot before its author has said. One anonymous lookup against
// ws.geonorge.no's stedsnavn register for the nearest name to the pin, ranked
// so that the answer is the kind of name an amateur would use for a place in
// the terrain rather than the nearest bus stop.
//
// Pre-fill only. Nothing re-derives the name afterwards: once the box is on
// the screen the field belongs to whoever is typing in it, and moving the pin
// must not overwrite what they wrote.
//
// This is the whole of what the old three-call locality context has become.
// Municipality and matrikkel went with the fields that held them — a flat spot
// has a name and a description, and a reader who wants the gårdsnummer has the
// property search for it.


// A name is ranked by `navneobjekttype` first and distance second; the three
// sets are drawn from the register's own 291-type vocabulary and anything
// unlisted is the neutral middle. Denied: administrative geography.
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

// Demoted, not denied: downtown it may be all there is.
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

// Ties on places with no `hovednavn`, where the first entry is often rejected.
const SETTLED_SPELLING = new Set([
  'godkjent',
  'godkjent og prioritert',
  'vedtatt',
  'vedteke',
]);

// Reach around the pin. Wide enough that a name almost always comes back, near
// enough that the name is about this hillside and not the next valley.
const SEARCH_RADIUS_M = 600;

// The box opens on the pin and fills in when this returns; it is never waited
// for. A lookup slower than this is one the author has already started typing
// over.
const TIMEOUT_MS = 6000;

/**
 * The spelling to show for one register entry: its `hovednavn` if it has one,
 * otherwise the first spelling with a settled status, otherwise whatever came
 * first.
 */
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

/**
 * The suggested name for a pin, or '' when the register has nothing to say.
 * Never throws and never hangs: every failure is an empty string, because a
 * spot the author names themselves is a working spot and a create button that
 * waits on a third party is not.
 */
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
