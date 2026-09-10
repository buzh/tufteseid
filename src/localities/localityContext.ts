import { getDistance } from 'ol/sphere';
import type { LocalityBbox } from '../api/localities';
import { getEnv } from '../env';
import type { PlaceNamePoint } from '../types/searchTypes';

/*
 * What the public registers already know about a rectangle, before the user
 * has typed anything: the nearest real placename, which kommune it is in,
 * and which matrikkel units it covers.
 *
 * Three independent anonymous lookups against ws.geonorge.no — the same host
 * `src/search/searchApi.ts` uses, already in the Caddyfile CSP, and small
 * enough (a few kB each) not to be worth routing through wmscache.
 *
 * Every one of them is optional. A lokalitet over open sea, over Sweden, or
 * created while GeoNorge is down is a perfectly valid lokalitet; nothing in
 * here may stop one being made. The three run in parallel and each failure
 * degrades to an empty string.
 *
 * The result pre-fills *editable* fields. It is a starting point, not a
 * derived truth: the register cannot know that the user means "the terrace
 * above Storevike", and once they have said so nothing re-derives it behind
 * their back. The one genuinely derived fact — the centre coordinate — is
 * not stored at all (`formatBboxCentre` in format.ts).
 */

const env = getEnv();

// Both the stedsnavn and the eiendom endpoints want a point and a radius,
// so a rectangle is queried as its centre plus enough reach to cover the
// corners. Floors keep a tiny lokalitet from finding nothing at all; ceilings
// keep a 25 km one from dragging in half a valley.
const PLACE_RADIUS_MIN_M = 250;
const PLACE_RADIUS_MAX_M = 1500;
const MATRIKKEL_RADIUS_MIN_M = 50;
const MATRIKKEL_RADIUS_MAX_M = 500;

// Nobody waits ten seconds to find out what their rectangle is called — the
// create button is disabled for the whole fetch, so this is the worst case a
// user can be made to sit through before falling back to "Uten navn".
const TIMEOUT_MS = 6000;

// A rectangle crossing more than this many properties is bigger than a
// matrikkel list usefully describes; the field stays editable either way.
const MAX_MATRIKKEL = 8;

/*
 * Stedsnavnregisteret classifies every name by `navneobjekttype`, and the
 * type — not the distance — is what separates a name worth putting on a
 * lokalitet from one that merely happens to be close. The three sets below
 * are drawn from the register's own published vocabulary
 * (ws.geonorge.no/stedsnavn/v1/navneobjekttyper, 291 types); everything not
 * listed forms the neutral middle tier, which is almost exactly the natural
 * landscape and settlement vocabulary — Vik, Haug, Ås, Tjern, Grend, Nes.
 *
 * Denied outright: administrative and statistical geography. A rectangle is
 * not a kommune, and "Innlandet fylke" tells you nothing the map didn't.
 */
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

/*
 * Promoted: the types this app exists for. A farm name or a recorded
 * settlement site is the anchor an archaeologist would reach for anyway, so
 * it outranks a nearer stream or knoll — but only by a few hundred metres'
 * worth of preference, not unconditionally.
 */
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

/*
 * Demoted, not denied: the built layer — buildings, roads, service points,
 * navigation marks. Downtown these are often the *only* names within reach,
 * and "Skolegata" beats "Uten navn", so they stay eligible. But a farm, a
 * hill or a bay several hundred metres away is a better anchor for an area
 * to explore than the street you would park in, so anything in this set
 * loses to anything outside it regardless of distance.
 */
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

// Bigger than any reachable meterFraPunkt, so the demoted tier sorts
// strictly after the other two instead of merely being penalised.
const DEMOTE_PENALTY_M = 1_000_000;

// A name whose point falls inside the rectangle is describing ground the
// user is actually looking at, so it beats a slightly closer one outside.
const INSIDE_BBOX_BONUS_M = 250;

// How much nearer a neutral name has to be to beat a promoted one.
const PROMOTE_BONUS_M = 400;

// Spellings the register has settled on. Used only to break ties on the
// places that have no `hovednavn` at all, where the raw first entry is
// often a rejected proposal.
const SETTLED_SPELLING = new Set([
  'godkjent',
  'godkjent og prioritert',
  'vedtatt',
  'vedteke',
]);

export type LocalityContext = {
  /** Nearest significant placename, or '' if the register has none. */
  place: string;
  /** "Vang (3454), Innlandet", or ''. */
  municipality: string;
  /** "12/6, 12/5, 10/1-2", or ''. */
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

/*
 * Every failure mode of these endpoints collapses to "no answer": a network
 * error, an abort, a 404 — kommuneinfo answers a point outside Norway with a
 * 404 *HTML* page, so a non-ok response must never reach res.json().
 */
const getJson = async <T>(url: URL, signal: AbortSignal): Promise<T | null> => {
  try {
    const res = await fetch(url.toString(), { signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
};

/*
 * EPSG:4326 lon/lat passed as koordsys=4258. The two differ by well under a
 * metre in Norway and GeoNorge's own services treat them interchangeably;
 * `getPropetyInfoByCoordinates` in searchApi.ts does the same.
 */
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
    // 'relikt' and 'uaktuell' names are historic. Tempting for archaeology,
    // but they are also where the register keeps abolished counties, and a
    // wrong auto-name is worse than none — the field is right there to type
    // one into.
    if (point.stedstatus !== 'aktiv') continue;
    // A few of the register's type labels carry trailing spaces ("Båe  ").
    const type = point.navneobjekttype.trim();
    if (NAME_TYPE_DENY.has(type)) continue;

    // Most places have a `hovednavn`; the ones that don't list several
    // spellings of equal standing, where the first is often a proposal that
    // was never adopted.
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

  // Nothing at all nearby happens on the høgfjell and out on the vidde,
  // which is precisely where a lokalitet is hardest to tell apart from the
  // next one. One wider sweep usually turns "Uten navn" into "Gråhøgda";
  // it only ever runs when the first pass came back empty-handed.
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
  // `/punkt` rather than `/punkt/omrader`: the same list, minus the teig
  // polygons, which are two orders of magnitude larger and drawn nowhere.
  const url = geonorgeUrl('/eiendom/v1/punkt', centre, {
    radius: radius.toString(),
    treffPerSide: '30',
    side: '1',
  });
  const data = await getJson<{ eiendom?: Teig[] }>(url, signal);
  return data?.eiendom ?? [];
};

/*
 * Nearest first, water and infrastructure parcels dropped, capped. Split
 * from the fetch because it needs the kommunenummer the *other* lookup
 * returns, and making it wait for that would serialise two calls that have
 * no reason not to overlap.
 */
const formatMatrikkel = (
  teiger: Teig[],
  municipalityNumber: string,
): string => {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const teig of [...teiger].sort(
    (a, b) => (a.meterFraPunkt ?? 0) - (b.meterFraPunkt ?? 0),
  )) {
    // Water surfaces come back as "Mnr vann mangler" with a null gårdsnummer,
    // and gnr ≥ 9000 is the reserved range for road, rail and watercourse
    // parcels. Neither is land anybody holds, and both crowd out the real
    // properties in a short list.
    const gnr = teig.gardsnummer;
    if (gnr == null || gnr <= 0 || gnr >= 9000) continue;
    if (!teig.matrikkelnummertekst) continue;

    // The kommune is already its own field, so only spell it out on the
    // parcels that fall outside it — a rectangle can straddle a border.
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

/**
 * Look up everything the registers know about `bbox`. Never rejects and
 * never takes longer than TIMEOUT_MS; missing answers come back as ''.
 */
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
    // The three helpers swallow their own failures, so reaching here means
    // something structural. Still not fatal: an unnamed lokalitet is fine.
    console.warn('[localityContext] lookup failed', e);
    return EMPTY_LOCALITY_CONTEXT;
  } finally {
    clearTimeout(timer);
  }
};
