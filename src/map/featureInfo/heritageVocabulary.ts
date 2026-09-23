import type { MaterialSymbol } from '../../ui/Icon';

// Keyed on the labels kart.ra.no puts on the wire, which differ from Geonorge's
// SOSI register spellings; the register's own are kept as aliases.

const normalize = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

/** `lokaliteteskategori` / `enkeltminnekategori` — the 12-value bucket, not the
 * 159-value `art`. */
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
  fartøy: 'sailing',
  'ruin (middelalder)': 'foundation',
  // Register spellings, as aliases.
  'arkeologisk lokalitet': 'history_edu',
  'arkeologisk enkeltminne': 'history_edu',
  bygningslokalitet: 'location_city',
  'kulturminne under vann - enkeltminne': 'scuba_diving',
  'teknisk/industrelt enkeltminne': 'factory',
  'ruiner fra middelalderen': 'foundation',
};

export const kategoriIcon = (kategori: string): MaterialSymbol =>
  KATEGORI_ICONS[normalize(kategori)] ?? 'castle';

/**
 * Vernetype, bucketed into `HERITAGE_RENDERS`' five vern subsets. `ukjent` is a
 * sixth, for an unmapped label: `uavklart` is a claim, not an absence.
 */
export type VernBucket =
  | 'fredede'
  | 'verneverdige'
  | 'listefoerte'
  | 'utenVern'
  | 'uavklart'
  | 'ukjent';

const VERN_BUCKETS: Record<string, VernBucket> = {
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
