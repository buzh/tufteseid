import { useAtomValue } from 'jotai';
import { activeLocalityAtom } from '../localities/atoms';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { LocalityRibbon } from './LocalityRibbon';
import styles from './Ribbon.module.css';
import { RibbonGlobalRow } from './RibbonGlobalRow';

/**
 * The bar across the top of the map. Four thin rows at most, in the order a
 * question leads to the next: row 1 is the map itself and is always there;
 * the settings strip under it holds the controls for whatever row 1 has
 * selected, and is absent when that ground has nothing to adjust; Terreng
 * alone adds a slider row beneath the strip; the lokalitet row is last, and
 * is a context strip rather than a surface.
 *
 * Nothing with a body goes here. The rule is about **bodies, not rows** — the
 * tray and the tool rows that were deleted grew the bar to five hundred
 * pixels, over the terrain the panels were describing, and what remains of
 * them is the extract panel in the dock. A row that stays one line tall costs
 * ~40 px and keeps the controls next to the thing they name; a row that can
 * grow does not, which is why RibbonSettingsRow's one-line cap is a contract
 * rather than a suggestion — and why Terrenganalyse's knobs came back out of
 * the dock as a second *line* rather than as a panel.
 *
 * `data-chrome="top"` is how `chromeInsets` finds out how much of the map the
 * bar is covering. Measured rather than a constant because the rows wrap on
 * narrow screens and the lower two come and go.
 *
 * Two error boundaries rather than one around the bar. A crash in the
 * lokalitet row should not take the search field and the background controls
 * with it — the map underneath stays usable, and that is the whole reason the
 * chrome floats over it. Row 1, the settings strip and the terrain sliders
 * share a boundary because they share the four control hooks: a crash in any
 * of them comes from the same state, so isolating them would buy nothing.
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
