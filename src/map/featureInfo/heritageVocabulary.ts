import type { MaterialSymbol } from '../../ui/Icon';

const normalize = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const KATEGORI_ICONS: Record<string, MaterialSymbol> = {

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

  'arkeologisk lokalitet': 'history_edu',
  'arkeologisk enkeltminne': 'history_edu',
  bygningslokalitet: 'location_city',
  'kulturminne under vann - enkeltminne': 'scuba_diving',
  'teknisk/industrelt enkeltminne': 'factory',
  'ruiner fra middelalderen': 'foundation',
};

export const kategoriIcon = (kategori: string): MaterialSymbol =>
  KATEGORI_ICONS[normalize(kategori)] ?? 'castle';

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

  'vernet etter pbl': 'verneverdige',
  'vernet etter plan- og bygningsloven': 'verneverdige',
  'regionalt verneverdig': 'verneverdige',
  'kommunalt verneverdig': 'verneverdige',
  'vernet fartøy': 'verneverdige',
  verdensarvstatus: 'verneverdige',

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
