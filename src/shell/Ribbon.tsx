import { useAtomValue } from 'jotai';
import { activeLocalityAtom } from '../localities/atoms';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { LocalityRibbon } from './LocalityRibbon';
import styles from './Ribbon.module.css';
import { RibbonGlobalRow } from './RibbonGlobalRow';

/**
 * The bar across the top of the map. Two thin rows at most: row 1 is the map
 * itself and is always there; row 2 is the open lokalitet, and is a context
 * strip rather than a surface.
 *
 * Nothing with a body goes here any more. The tray and the tool rows used to
 * grow the bar to five hundred pixels — over the terrain the panels were
 * describing — and have moved to the dock in the right slot.
 *
 * `data-chrome="top"` is how `chromeInsets` finds out how much of the map the
 * bar is covering. Measured rather than a constant because the rows wrap on
 * narrow screens and row 2 comes and goes.
 *
 * Each row gets its own error boundary rather than one around the bar. A
 * crash in the lokalitet row should not take the search field and the
 * background controls with it — the map underneath stays usable, and that is
 * the whole reason the chrome floats over it.
 */
export const Ribbon = () => {
  const activeLocality = useAtomValue(activeLocalityAtom);

  return (
    <div className={styles.bar} data-chrome="top">
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
