import { useAtomValue } from 'jotai';
import { activeLocalityAtom } from '../localities/atoms';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { LocalityRibbon } from './LocalityRibbon';
import styles from './Ribbon.module.css';
import { RibbonGlobalRow } from './RibbonGlobalRow';

/**
 * The bar across the top of the map. One row per level of context: row 1 is
 * the map itself and is always there; the rest appear with an open lokalitet.
 *
 * Each row gets its own error boundary rather than one around the bar. A
 * crash in a lokalitet row should not take the search field and the
 * background controls with it — the map underneath stays usable, and that
 * is the whole reason the chrome floats over it.
 */
export const Ribbon = () => {
  const activeLocality = useAtomValue(activeLocalityAtom);

  return (
    <div className={styles.bar}>
      <ErrorBoundary name="RibbonGlobalRow">
        <RibbonGlobalRow />
      </ErrorBoundary>
      {activeLocality && (
        // Keyed so swapping lokalitet remounts the controller with fresh
        // form state rather than carrying the previous one's draft across.
        <LocalityRibbon key={activeLocality.id} locality={activeLocality} />
      )}
    </div>
  );
};
