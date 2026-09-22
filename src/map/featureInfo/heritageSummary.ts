// What a GetFeatureInfo over the Kulturminner layers actually means, turned into
// something a surface can render without knowing anything about Riksantikvaren.
//
// Three jobs, in order. **Classify**: `parseXmlFeatureInfo` loses the sublayer
// element name each feature came back under, so the kind is re-derived from the
// property fingerprint. **Group**: a click lands on a lokalitet, its
// enkeltminner, its sikringssone and the icon twins of all of them at once —
// five features that are one thing — so they are folded onto the parent id.
// **Summarize**: the five registers say the same things under different field
// names, and the surfaces should not each have to know which.
//
// The field names below were read off live GetFeatureInfo rather than off a
// specification: sefrak serves objektnavn / bygningstypetekst /
// tidsangivelsetekst / askeladdenid, brukerminner tittel / beskrivelse /
// opprettet_av / opprettet and no id at all, the rest navn / informasjon /
// datering. That is also why nothing here defaults: a field the register does
// not serve comes back empty and the surface leaves the line out.

import type { LayerFeatureInfo } from './types';
import { vernBucket, type VernBucket } from './heritageVocabulary';

export type FeatureKind =
  | 'lokalitet'
  | 'enkeltminne'
  | 'sikringssone'
  | 'sefrak'
  | 'kulturmiljo'
  | 'brukerminne';

interface HeritageFeature {
  kind: FeatureKind;
  layerTitle: string;
  properties: Record<string, string | number | boolean | null>;
}

interface HeritageGroup {
  parentId: string;
  lokalitet?: HeritageFeature;
  enkeltminner: HeritageFeature[];
  sikringssoner: HeritageFeature[];
  others: HeritageFeature[];
}

/** One enkeltminne under a lokalitet, as the popup lists them. */
export interface EnkeltminneSummary {
  key: string;
  /** The register's own id, empty where it serves none; the key may be ours. */
  id: string;
  navn: string;
  art: string;
  kategori: string;
  vernetype: string;
  datering: string;
}

/**
 * One thing on the map, whatever number of WMS features said so.
 *
 * Every string field is empty rather than absent when the register serves
 * nothing, and the two plural ones are the values rolled up across a lokalitet
 * and its enkeltminner — one entry where they agree, several where they do not,
 * which is a distinction the surface has to word and this module must not.
 */
export interface HeritageSummary {
  key: string;
  kind: FeatureKind;
  /** The name of the register it came out of, for a kind with no noun of ours. */
  layerTitle: string;
  /** An id the register owns and a reader can quote back at it; never ours. */
  id: string;
  /** Empty when genuinely unnamed — the surface falls back to `art`. */
  navn: string;
  /** The 159-value `art`: the subtitle. */
  art: string;
  /** The 12-value bucket `kategori`, which is what the glyph is chosen from. */
  kategori: string;
  vernetyper: string[];
  /** One bucket where they agree, `ukjent` where they do not. */
  vernTone: VernBucket;
  /** Only where one vernetype and one date are shared, or it would misdate. */
  vernedato: string;
  dateringer: string[];
  kommune: string;
  antallEnkeltminner: string;
  informasjon: string;
  /** Brukerminner: who reported it takes vernestatus' place. */
  registrertAv: string;
  registrert: string;
  askeladden: string;
  kulturminnesok: string;
  enkeltminner: EnkeltminneSummary[];
}

const LAYER_KINDS: Record<string, FeatureKind> = {
  'theme.heritageSites': 'lokalitet',
  'theme.protectedBuildings': 'lokalitet',
  'theme.culturalEnvironments': 'kulturmiljo',
  'theme.sefrakBuildings': 'sefrak',
  'theme.userReportedHeritage': 'brukerminne',
};

const refineHeritageSitesKind = (
  properties: Record<string, unknown>,
): FeatureKind => {
  if ('enkeltminneart' in properties || 'lokalitetid' in properties)
    return 'enkeltminne';
  if ('lokalitetsart' in properties || 'antallenkeltminner' in properties)
    return 'lokalitet';
  // Sikringssoner carry a kulturminneid and almost nothing else.
  if (
    'kulturminneid' in properties &&
    !('navn' in properties) &&
    !('lokalitetsart' in properties) &&
    !('enkeltminneart' in properties)
  )
    return 'sikringssone';
  return 'lokalitet';
};

const stringify = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '';
  return String(v);
};

const firstOf = (
  properties: Record<string, unknown>,
  keys: readonly string[],
): string => {
  for (const key of keys) {
    const value = stringify(properties[key]);
    if (value) return value;
  }
  return '';
};

const NAME_FIELDS = ['navn', 'objektnavn', 'tittel'] as const;
const DESCRIPTION_FIELDS = ['informasjon', 'beskrivelse'] as const;
const ART_FIELDS = [
  'lokalitetsart',
  'enkeltminneart',
  'kulturmiljokategori',
  'bygningstypetekst',
  'sefrakstatustekst',
] as const;
const DATERING_FIELDS = ['datering', 'tidsangivelsetekst'] as const;
const ID_FIELDS = ['lokalid', 'kulturminneid', 'askeladdenid'] as const;

// Brukerminner serve no id, so the kulturminnesøk link is the only thing on the
// wire separating two of them.
const identityOf = (properties: Record<string, unknown>): string =>
  firstOf(properties, ID_FIELDS) || stringify(properties['linkkulturminnesok']);

const formatDate = (v: unknown): string => {
  const s = stringify(v);
  if (!s) return '';
  // "2014-12-17 00:00:00" → "2014-12-17"
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s;
};

/** Unique, in order, empties dropped. */
const distinct = (values: string[]): string[] =>
  Array.from(new Set(values.filter((v) => v.length > 0)));

const getParentId = (
  feature: HeritageFeature,
  fallbackIndex: number,
): string => {
  const p = feature.properties;
  if (feature.kind === 'enkeltminne') {
    const lokalitetid = stringify(p['lokalitetid']);
    if (lokalitetid) return lokalitetid;
    const lokalid = stringify(p['lokalid']);
    if (lokalid) return lokalid.split('-')[0];
  }
  if (feature.kind === 'lokalitet') {
    // Some ids are suffixed ("300651-0") and the lokalitetid enkeltminner name
    // is the numeric prefix.
    const raw =
      stringify(p['kulturminneid']) ||
      stringify(p['lokalid']) ||
      stringify(p['lokalitetid']);
    if (raw) return raw.split('-')[0];
    return `lok-${fallbackIndex}`;
  }
  if (feature.kind === 'sikringssone') {
    // Sikringssoner have their own id space; keep them as their own group.
    return `sz-${stringify(p['lokalid']) || stringify(p['kulturminneid']) || fallbackIndex}`;
  }
  return identityOf(p) || stringify(p['objid']) || `other-${fallbackIndex}`;
};

const toHeritageFeatures = (layers: LayerFeatureInfo[]): HeritageFeature[] => {
  const out: HeritageFeature[] = [];
  for (const layer of layers) {
    const baseKind = LAYER_KINDS[layer.layerId];
    if (!baseKind) continue;
    for (const feature of layer.features) {
      out.push({
        kind:
          baseKind === 'lokalitet'
            ? refineHeritageSitesKind(feature.properties)
            : baseKind,
        layerTitle: layer.layerTitle,
        properties: feature.properties,
      });
    }
  }
  return out;
};

const groupFeatures = (layers: LayerFeatureInfo[]): HeritageGroup[] => {
  const features = toHeritageFeatures(layers);

  // Dedupe the *ikoner twins — one record drawn twice, as a polygon and as a
  // pin — keeping whichever copy carries more fields. A record with no identity
  // gets a key of its own rather than colliding with the next one.
  let anonymous = 0;
  const seen = new Map<string, HeritageFeature>();
  for (const f of features) {
    const key = `${f.kind}::${identityOf(f.properties) || `#${anonymous++}`}`;
    const prev = seen.get(key);
    if (
      !prev ||
      Object.keys(f.properties).length > Object.keys(prev.properties).length
    ) {
      seen.set(key, f);
    }
  }

  const groups = new Map<string, HeritageGroup>();
  let fallback = 0;
  for (const f of seen.values()) {
    const parentId = getParentId(f, fallback++);
    let g = groups.get(parentId);
    if (!g) {
      g = { parentId, enkeltminner: [], sikringssoner: [], others: [] };
      groups.set(parentId, g);
    }
    if (f.kind === 'lokalitet') g.lokalitet = f;
    else if (f.kind === 'enkeltminne') g.enkeltminner.push(f);
    else if (f.kind === 'sikringssone') g.sikringssoner.push(f);
    else g.others.push(f);
  }

  const all = Array.from(groups.values());

  // A sikringssone is metadata for a lokalitet, not a result of its own — so it
  // is dropped as a card wherever a real record came back with it, and kept
  // where it is all there was.
  const hasReal = all.some((g) => g.lokalitet || g.enkeltminner.length > 0);
  return hasReal
    ? all.filter(
        (g) => g.lokalitet || g.enkeltminner.length > 0 || g.others.length > 0,
      )
    : all;
};

const summarizeGroup = (group: HeritageGroup): HeritageSummary => {
  const primary =
    group.lokalitet ??
    group.enkeltminner[0] ??
    group.sikringssoner[0] ??
    group.others[0];
  const props = primary?.properties ?? {};

  // With no lokalitet the first enkeltminne is the card itself, not a child.
  const nested = group.lokalitet
    ? group.enkeltminner
    : group.enkeltminner.slice(1);
  const isSikringssone = !group.lokalitet && group.sikringssoner.length > 0;
  const hasReal = !!group.lokalitet || group.enkeltminner.length > 0;

  const kind: FeatureKind = group.lokalitet
    ? 'lokalitet'
    : isSikringssone
      ? 'sikringssone'
      : group.enkeltminner.length > 0
        ? 'enkeltminne'
        : (group.others[0]?.kind ?? 'enkeltminne');

  // The lokalitet names the group; an unnamed one borrows its first
  // enkeltminne's name, and only then falls through to the other registers.
  const navn =
    stringify(group.lokalitet?.properties['navn']) ||
    stringify(group.enkeltminner[0]?.properties['navn']) ||
    (group.others.length > 0
      ? firstOf(group.others[0].properties, NAME_FIELDS)
      : '');

  const members = [
    ...(group.lokalitet ? [group.lokalitet.properties] : []),
    ...group.enkeltminner.map((em) => em.properties),
  ];
  const memberProps = members.length > 0 ? members : [props];

  const vernetyper = distinct(
    memberProps.map((p) => stringify(p['vernetype'])),
  );
  const vernBuckets = new Set(vernetyper.map(vernBucket));
  const vernedatoer = distinct(
    memberProps.map((p) => formatDate(p['vernedato'])),
  );

  // Only the synthesized Askeladden URL needs the guard: a sikringssone's id is
  // from another space and a `kid=` built out of it 404s.
  const askeladden =
    stringify(props['linkaskeladden']) ||
    (hasReal && props['lokalid']
      ? `https://askeladden.ra.no/askeladden/?kid=${stringify(props['lokalid'])}`
      : '');

  return {
    key: group.parentId,
    kind,
    layerTitle: primary?.layerTitle ?? '',
    id:
      hasReal || isSikringssone
        ? group.parentId.replace(/^sz-/, '')
        : firstOf(props, ID_FIELDS),
    navn,
    art: firstOf(props, ART_FIELDS),
    kategori:
      stringify(props['lokaliteteskategori']) ||
      stringify(props['enkeltminnekategori']),
    vernetyper,
    vernTone: vernBuckets.size === 1 ? [...vernBuckets][0] : 'ukjent',
    vernedato:
      vernetyper.length === 1 && vernedatoer.length === 1 ? vernedatoer[0] : '',
    dateringer: distinct(memberProps.map((p) => firstOf(p, DATERING_FIELDS))),
    // kulturminner2 serves no `fylke` and brukerminner do; a kommune name on
    // its own is ambiguous nationally.
    kommune: [stringify(props['kommune']), stringify(props['fylke'])]
      .filter(Boolean)
      .join(', '),
    antallEnkeltminner: group.lokalitet
      ? stringify(group.lokalitet.properties['antallenkeltminner'])
      : '',
    informasjon: firstOf(props, DESCRIPTION_FIELDS),
    registrertAv: stringify(props['opprettet_av']),
    registrert: formatDate(props['opprettet']),
    askeladden,
    kulturminnesok: stringify(props['linkkulturminnesok']),
    enkeltminner: nested.map((em, i) => ({
      key: stringify(em.properties['lokalid']) || `em-${i}`,
      id: stringify(em.properties['lokalid']),
      navn: stringify(em.properties['navn']),
      art: stringify(em.properties['enkeltminneart']),
      kategori: stringify(em.properties['enkeltminnekategori']),
      vernetype: stringify(em.properties['vernetype']),
      datering: stringify(em.properties['datering']),
    })),
  };
};

/** Everything one point on the map has to say, one entry per thing rather than
 *  one per WMS feature. */
export const summarizeHeritage = (
  layers: LayerFeatureInfo[],
): HeritageSummary[] => groupFeatures(layers).map(summarizeGroup);
