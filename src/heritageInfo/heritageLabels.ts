// The handful of decisions the tip and the card both make about one summary:
// which glyph stands for it, what colour its vernestatus wears, and how a field
// that came back with several values is worded down to one line.
//
// The wording itself stays at the call sites — `t()` belongs in a component,
// and these take the finished string rather than a `TFunction`.

import type {
  FeatureKind,
  HeritageSummary,
} from '../map/featureInfo/heritageSummary';
import type { VernBucket } from '../map/featureInfo/heritageVocabulary';
import { kategoriIcon } from '../map/featureInfo/heritageVocabulary';
import type { MaterialSymbol } from '../ui';
import styles from './vernTone.module.css';

// The three registers with no kategori of their own: the glyph names the
// register instead. The rest are chosen from the 12-value bucket.
const KIND_ICONS: Partial<Record<FeatureKind, MaterialSymbol>> = {
  sefrak: 'house',
  kulturmiljo: 'landscape',
  brukerminne: 'person_pin_circle',
};

export const summaryIcon = (summary: HeritageSummary): MaterialSymbol =>
  KIND_ICONS[summary.kind] ??
  (summary.kategori ? kategoriIcon(summary.kategori) : 'castle');

export const vernToneClass = (tone: VernBucket): string | undefined =>
  styles[tone];

/** A field rolled up across a lokalitet and its enkeltminner: the shared value
 *  where they agree, and the caller's "Ulike …" wording where they do not. */
export const rollup = (values: readonly string[], aggregate: string): string =>
  values.length === 0 ? '' : values.length === 1 ? values[0] : aggregate;
