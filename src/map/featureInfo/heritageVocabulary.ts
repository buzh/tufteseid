import type { MaterialSymbol } from '../../ui';

/*
 * The two closed vocabularies the Kulturminner popup draws as icons.
 *
 * Both are keyed on the labels kart.ra.no actually puts on the wire, which are
 * *not* the labels in Geonorge's SOSI register — the service collapses
 * "Arkeologisk lokalitet" and "Arkeologisk enkeltminne" into one
 * "Arkeologisk minne", abbreviates "Vernet etter plan- og bygningsloven" to
 * "Vernet etter PBL", and drops the noun from "Uavklart vernestatus". The
 * register's spellings are kept as aliases anyway: they cost a line each and
 * they are what a future service version is most likely to switch to.
 *
 * Measured, not assumed. A sweep of 14 dense areas (Oslo, Trondheim, Bergen,
 * Borre, Jæren, Lofoten, Røros, Tromsø, Finnmark, …) returning ~1300 features
 * saw 3 distinct `lokaliteteskategori`, 9 distinct `enkeltminnekategori` and
 * 13 distinct `vernetype` values, all of them below. The register caps those
 * at 12 and 20 respectively, so the tables are complete by construction and
 * the fallbacks exist for a service change rather than for a gap.
 *
 * `fylke` is absent from this file because kulturminner2 does not serve it —
 * not once in 1300 features. The brukerminner WMS does, and the popup prints
 * it there; it is a plain string either way, so it needs no vocabulary.
 */

const normalize = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// Kategori — the card's leading icon
// ---------------------------------------------------------------------------

/**
 * `lokaliteteskategori` / `enkeltminnekategori` → glyph. Coarse on purpose:
 * this is the 12-value bucket, not the 159-value `art`, which no icon could
 * carry and which the card therefore prints as text.
 */
const KATEGORI_ICONS: Record<string, MaterialSymbol> = {
  // Served by the WMS.
  'arkeologisk minne': 'history_edu',
  'bebyggelse-infrastruktur': 'location_city',
  bygning: 'house',
  kirkested: 'church',
  kirke: 'church',
  utomhuselement: 'yard',
  'kulturminne under vann': 'scuba_diving',
  'teknisk/industrielt minne': 'factory',
  bergkunst: 'brush',
  'fartøy': 'sailing',
  'ruin (middelalder)': 'foundation',
  // Register spellings, as aliases.
  'arkeologisk lokalitet': 'history_edu',
  'arkeologisk enkeltminne': 'history_edu',
  bygningslokalitet: 'location_city',
  'kulturminne under vann - enkeltminne': 'scuba_diving',
  'teknisk/industrelt enkeltminne': 'factory',
  'ruiner fra middelalderen': 'foundation',
};

/** `castle` is the app's noun for the whole register, so it is the fallback. */
export const kategoriIcon = (kategori: string): MaterialSymbol =>
  KATEGORI_ICONS[normalize(kategori)] ?? 'castle';

// ---------------------------------------------------------------------------
// Vernetype — the icon-only chip needs a colour to mean anything
// ---------------------------------------------------------------------------

/**
 * The five buckets are `HERITAGE_RENDERS`' vern subsets (src/map/layers/
 * heritage.ts), so a chip's colour means the same thing as the subset filter
 * in the Kulturminner pulldown. `ukjent` is *not* a sixth bucket in that sense
 * — it is what an unmapped label gets, and it is neutral rather than folded
 * into `uavklart`, because "the register says the status is unclear" and "we
 * did not recognise what the register said" are different claims.
 */
export type VernBucket =
  | 'fredede'
  | 'verneverdige'
  | 'listefoerte'
  | 'utenVern'
  | 'uavklart'
  | 'ukjent';

const VERN_BUCKETS: Record<string, VernBucket> = {
  // Fredet by law or by decision.
  'automatisk fredet': 'fredede',
  vedtaksfredet: 'fredede',
  forskriftsfredet: 'fredede',
  'midlertidig fredet': 'fredede',
  // Protected by something other than kulturminneloven's fredning.
  'vernet etter pbl': 'verneverdige',
  'vernet etter plan- og bygningsloven': 'verneverdige',
  'regionalt verneverdig': 'verneverdige',
  'kommunalt verneverdig': 'verneverdige',
  'vernet fartøy': 'verneverdige',
  verdensarvstatus: 'verneverdige',
  // On a list, which is weaker than either of the above.
  'listeført kirke': 'listefoerte',
  'statlig listeført': 'listefoerte',
  'kommunalt listeført': 'listefoerte',
  // Had protection and lost it, or never had any.
  'uten vern': 'utenVern',
  'ikke fredet': 'utenVern',
  'opphevet vern': 'utenVern',
  'opphevet fredning': 'utenVern',
  'fredning opphevet': 'utenVern',
  'fjernet (aut. fredet)': 'utenVern',
  'fjernet (automatisk fredet)': 'utenVern',
  // Undecided, in progress, or several statuses at once.
  uavklart: 'uavklart',
  'uavklart vernestatus': 'uavklart',
  'fredningssak pågår': 'uavklart',
  'sammensatt vernestatus': 'uavklart',
};

export const vernBucket = (vernetype: string): VernBucket =>
  VERN_BUCKETS[normalize(vernetype)] ?? 'ukjent';

export const VERN_ICONS: Record<VernBucket, MaterialSymbol> = {
  fredede: 'gavel',
  verneverdige: 'shield',
  listefoerte: 'list_alt',
  utenVern: 'remove_moderator',
  uavklart: 'shield_question',
  ukjent: 'shield',
};
