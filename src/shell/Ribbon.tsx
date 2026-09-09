import { ErrorBoundary } from '../shared/ErrorBoundary';
import styles from './Ribbon.module.css';
import { RibbonGlobalRow } from './RibbonGlobalRow';

/**
 * The bar across the top of the map. One row per level of context: row 1 is
 * the map itself and is always there.
 *
 * Each row gets its own error boundary rather than one around the bar. A
 * crash in a lokalitet row should not take the search field and the
 * background controls with it — the map underneath stays usable, and that
 * is the whole reason the chrome floats over it.
 */
export const Ribbon = () => (
  <div className={styles.bar}>
    <ErrorBoundary name="RibbonGlobalRow">
      <RibbonGlobalRow />
    </ErrorBoundary>
  </div>
);
