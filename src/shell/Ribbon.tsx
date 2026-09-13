import { useAtomValue } from 'jotai';
import { funnSessionAtom } from '../funn/session';
import { activeLocalityAtom } from '../localities/atoms';
import { localityPlacementAtom } from '../localities/placement';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { cx } from '../ui';
import { LocalityRibbon } from './LocalityRibbon';
import styles from './Ribbon.module.css';
import { RibbonGlobalRow } from './RibbonGlobalRow';
import { RibbonPlaceLocalityRow } from './RibbonPlaceLocalityRow';

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
 * them is the extract dialog. A row that stays one line tall costs ~40 px and
 * keeps the controls next to the thing they name; a row that can grow does
 * not, which is why RibbonSettingsRow's one-line cap is a contract rather
 * than a suggestion — and why Terrenganalyse's knobs came out of the dock as
 * a second *line* rather than as a panel.
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
  const placement = useAtomValue(localityPlacementAtom);
  const drawing = useAtomValue(funnSessionAtom) != null;

  return (
    <div className={styles.bar} data-chrome="top">
      {/*
        Row 1 stands down while a funn is being drawn. Everything on it —
        the grounds, the dataset ring, Stedsinfo, the settings strip under
        it — changes what is on the map, and the drawing is registered to the
        map as it stood when the pen went down (src/funn/frame.ts): swap the
        ground underneath and the strokes are over terrain nobody traced.

        Inert rather than absent so the bar does not change height mid-
        session, and greyed so that reads as deliberate rather than as a
        control that stopped working. The *lokalitet* row deliberately stays
        live: the pen that ends the session is on it.
      */}
      <div className={cx(drawing && styles.standDown)} inert={drawing}>
        <ErrorBoundary name="RibbonGlobalRow">
          <RibbonGlobalRow />
        </ErrorBoundary>
      </div>
      {/* A rectangle being placed and an open lokalitet are mutually exclusive
          by construction: starting a placement closes whatever was open
          (placement.ts), and committing one opens the record it made. So the
          bar never carries two sets of exits, and neither branch has to know
          about the other. Keyed on the session so a second `Ny lokalitet`
          re-seeds from the screen rather than leaving the old rectangle where
          it was. */}
      {placement && (
        <ErrorBoundary name="RibbonPlaceLocalityRow">
          <RibbonPlaceLocalityRow key={placement.id} placement={placement} />
        </ErrorBoundary>
      )}
      {activeLocality && (
        // Keyed so swapping lokalitet remounts the controller with fresh
        // form state rather than carrying the previous one's draft across.
        <LocalityRibbon key={activeLocality.id} locality={activeLocality} />
      )}
    </div>
  );
};
