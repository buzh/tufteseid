import type {
  FeatureKind,
  HeritageSummary,
} from '../map/featureInfo/heritageSummary';
import type { VernBucket } from '../map/featureInfo/heritageVocabulary';
import { kategoriIcon } from '../map/featureInfo/heritageVocabulary';
import type { MaterialSymbol } from '../ui';
import styles from './vernTone.module.css';

// The three registers with no kategori of their own.
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

/** The shared value where all agree, else the caller's "Ulike …" wording. */
export const rollup = (values: readonly string[], aggregate: string): string =>
  values.length === 0 ? '' : values.length === 1 ? values[0] : aggregate;
