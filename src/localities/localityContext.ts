import { getDistance } from 'ol/sphere';
import type { LocalityBbox } from '../api/localities';
import { getEnv } from '../env';
import type { PlaceNamePoint } from '../types/searchTypes';

// Nearest placename, kommune and matrikkel for a rectangle, from three
// anonymous ws.geonorge.no lookups in parallel. Never fatal and never slow:
// each failure degrades to '' and TIMEOUT_MS bounds the lot. Pre-fill only —
// nothing re-derives the fields afterwards.

const env = getEnv();

// The point endpoints take a radius: centre plus reach enough for the corners.
const PLACE_RADIUS_MIN_M = 250;
const PLACE_RADIUS_MAX_M = 1500;
const MATRIKKEL_RADIUS_MIN_M = 50;
const MATRIKKEL_RADIUS_MAX_M = 500;

// The create button is disabled for the whole fetch.
const TIMEOUT_MS = 6000;

// Past this a matrikkel list stops describing anything.
const MAX_MATRIKKEL = 8;

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

// Bigger than any reachable meterFraPunkt: the demoted tier sorts strictly last.
const DEMOTE_PENALTY_M = 1_000_000;

// A name inside the rectangle beats a slightly closer one outside.
const INSIDE_BBOX_BONUS_M = 250;

// How much nearer a neutral name has to be to beat a promoted one.
const PROMOTE_BONUS_M = 400;

// Ties on places with no `hovednavn`, where the first entry is often rejected.
const SETTLED_SPELLING = new Set([
  'godkjent',
  'godkjent og prioritert',
  'vedtatt',
  'vedteke',
]);

export type LocalityContext = {
  place: string;
  /** "Vang (3454), Innlandet". */
  municipality: string;
  /** "12/6, 12/5, 10/1-2". */
  matrikkel: string;
};

const EMPTY_LOCALITY_CONTEXT: LocalityContext = {
  place: '',
  municipality: '',
  matrikkel: '',
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const bboxCentre = (bbox: LocalityBbox): { lon: number; lat: number } => ({
  lon: (bbox[0] + bbox[2]) / 2,
  lat: (bbox[1] + bbox[3]) / 2,
});

const bboxHalfDiagonalM = (bbox: LocalityBbox): number =>
  getDistance([bbox[0], bbox[1]], [bbox[2], bbox[3]]) / 2;

// kommuneinfo answers a point outside Norway with a 404 HTML page, so a non-ok
// response must never reach json().
const getJson = async <T>(url: URL, signal: AbortSignal): Promise<T | null> => {
  try {
    const res = await fetch(url.toString(), { signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
};

// EPSG:4326 lon/lat passed as koordsys=4258: under a metre apart in Norway.
const geonorgeUrl = (
  path: string,
  centre: { lon: number; lat: number },
  params: Record<string, string>,
): URL => {
  const url = new URL(`${env.geoNorgeApiBaseUrl}${path}`);
  url.searchParams.set('nord', centre.lat.toString());
  url.searchParams.set('ost', centre.lon.toString());
  url.searchParams.set('koordsys', '4258');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
};

const pickPlaceName = (
  points: PlaceNamePoint[],
  bbox: LocalityBbox,
): string => {
  let bestName = '';
  let bestScore = Number.POSITIVE_INFINITY;

  for (const point of points) {
    // 'relikt' and 'uaktuell' are historic names and abolished counties.
    if (point.stedstatus !== 'aktiv') continue;
    // A few of the register's type labels carry trailing spaces ("Båe  ").
    const type = point.navneobjekttype.trim();
    if (NAME_TYPE_DENY.has(type)) continue;

    // Places without a `hovednavn` list several spellings of equal standing.
    const entry =
      point.stedsnavn.find((n) => n.navnestatus === 'hovednavn') ??
      point.stedsnavn.find((n) => SETTLED_SPELLING.has(n.skrivemåtestatus)) ??
      point.stedsnavn[0];
    if (!entry?.skrivemåte) continue;

    const { øst: lon, nord: lat } = point.representasjonspunkt;
    const inside =
      lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];

    const score =
      point.meterFraPunkt -
      (inside ? INSIDE_BBOX_BONUS_M : 0) -
      (NAME_TYPE_PROMOTE.has(type) ? PROMOTE_BONUS_M : 0) +
      (NAME_TYPE_DEMOTE.has(type) ? DEMOTE_PENALTY_M : 0);

    if (score < bestScore) {
      bestScore = score;
      bestName = entry.skrivemåte;
    }
  }

  return bestName;
};

const placeNamesWithin = async (
  centre: { lon: number; lat: number },
  radius: number,
  signal: AbortSignal,
): Promise<PlaceNamePoint[]> => {
  const url = geonorgeUrl('/stedsnavn/v1/punkt', centre, {
    radius: radius.toString(),
    treffPerSide: '50',
    side: '1',
  });
  const data = await getJson<{ navn?: PlaceNamePoint[] }>(url, signal);
  return data?.navn ?? [];
};

const fetchPlaceName = async (
  bbox: LocalityBbox,
  centre: { lon: number; lat: number },
  signal: AbortSignal,
): Promise<string> => {
  const radius = clamp(
    Math.round(bboxHalfDiagonalM(bbox)) + 150,
    PLACE_RADIUS_MIN_M,
    PLACE_RADIUS_MAX_M,
  );
  const near = pickPlaceName(
    await placeNamesWithin(centre, radius, signal),
    bbox,
  );
  if (near || radius >= PLACE_RADIUS_MAX_M) return near;

  // One wider sweep, only when the first pass found nothing.
  return pickPlaceName(
    await placeNamesWithin(centre, PLACE_RADIUS_MAX_M, signal),
    bbox,
  );
};

type KommuneInfo = {
  kommunenavn?: string;
  kommunenummer?: string;
  fylkesnavn?: string;
};

const fetchMunicipality = async (
  centre: { lon: number; lat: number },
  signal: AbortSignal,
): Promise<{ text: string; number: string }> => {
  const url = geonorgeUrl('/kommuneinfo/v1/punkt', centre, {});
  const info = await getJson<KommuneInfo>(url, signal);
  if (!info?.kommunenavn) return { text: '', number: '' };

  const number = info.kommunenummer ?? '';
  const head = number ? `${info.kommunenavn} (${number})` : info.kommunenavn;
  // Oslo is both kommune and fylke; repeating it reads as a mistake.
  const tail =
    info.fylkesnavn && info.fylkesnavn !== info.kommunenavn
      ? `, ${info.fylkesnavn}`
      : '';
  return { text: `${head}${tail}`, number };
};

type Teig = {
  gardsnummer: number | null;
  matrikkelnummertekst?: string;
  kommunenummer?: string;
  meterFraPunkt?: number;
};

const fetchTeiger = async (
  bbox: LocalityBbox,
  centre: { lon: number; lat: number },
  signal: AbortSignal,
): Promise<Teig[]> => {
  const radius = clamp(
    Math.round(bboxHalfDiagonalM(bbox)),
    MATRIKKEL_RADIUS_MIN_M,
    MATRIKKEL_RADIUS_MAX_M,
  );
  // `/punkt` rather than `/punkt/omrader`: same list, no teig polygons.
  const url = geonorgeUrl('/eiendom/v1/punkt', centre, {
    radius: radius.toString(),
    treffPerSide: '30',
    side: '1',
  });
  const data = await getJson<{ eiendom?: Teig[] }>(url, signal);
  return data?.eiendom ?? [];
};

// Split from the fetch so it can take the other lookup's kommunenummer without
// serialising the two.
const formatMatrikkel = (
  teiger: Teig[],
  municipalityNumber: string,
): string => {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const teig of [...teiger].sort(
    (a, b) => (a.meterFraPunkt ?? 0) - (b.meterFraPunkt ?? 0),
  )) {
    // Null gårdsnummer is water; gnr ≥ 9000 is road, rail and watercourse.
    const gnr = teig.gardsnummer;
    if (gnr == null || gnr <= 0 || gnr >= 9000) continue;
    if (!teig.matrikkelnummertekst) continue;

    // A rectangle can straddle a border: name the kommune only on the outsiders.
    const kommune = teig.kommunenummer ?? '';
    const label =
      kommune && kommune !== municipalityNumber
        ? `${kommune}-${teig.matrikkelnummertekst}`
        : teig.matrikkelnummertekst;

    if (seen.has(label)) continue;
    seen.add(label);
    parts.push(label);
    if (parts.length >= MAX_MATRIKKEL) break;
  }
  return parts.join(', ');
};

/** Never rejects, never exceeds TIMEOUT_MS; missing answers come back as ''. */
export const fetchLocalityContext = async (
  bbox: LocalityBbox,
): Promise<LocalityContext> => {
  const centre = bboxCentre(bbox);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const [place, municipality, teiger] = await Promise.all([
      fetchPlaceName(bbox, centre, ac.signal),
      fetchMunicipality(centre, ac.signal),
      fetchTeiger(bbox, centre, ac.signal),
    ]);
    return {
      place,
      municipality: municipality.text,
      matrikkel: formatMatrikkel(teiger, municipality.number),
    };
  } catch (e) {
    // The helpers swallow their own failures, so this is structural.
    console.warn('[localityContext] lookup failed', e);
    return EMPTY_LOCALITY_CONTEXT;
  } finally {
    clearTimeout(timer);
  }
};
