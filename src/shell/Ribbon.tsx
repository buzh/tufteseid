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
 * The bar across the top of the map: row 1 always, then a placement row, the
 * lokalitet row and the funn draft row as context appears. Nothing with a
 * body goes here — rows stay one line tall, which is what keeps the bar off
 * the terrain it is describing.
 *
 * `data-chrome="top"` is how `chromeInsets` measures how much of the map the
 * bar covers; measured rather than a constant because rows wrap and come and
 * go.
 *
 * Separate error boundaries per row so a crash in the lokalitet row leaves
 * the search field and the background controls usable. Row 1 and its settings
 * strip share one: they share the four control hooks.
 */
export const Ribbon = () => {
  const activeLocality = useAtomValue(activeLocalityAtom);
  const placement = useAtomValue(localityPlacementAtom);
  const drawing = useAtomValue(funnSessionAtom) != null;

  return (
    <div className={styles.bar} data-chrome="top">
      {/*
        Row 1 stands down while a funn is being drawn: the drawing is
        registered to the map as it stood when the pen went down
        (src/funn/frame.ts), so changing the ground puts the strokes over
        terrain nobody traced. Inert rather than absent so the bar keeps its
        height. The lokalitet row stays live — the exit is on it.
      */}
      <div className={cx(drawing && styles.standDown)} inert={drawing}>
        <ErrorBoundary name="RibbonGlobalRow">
          <RibbonGlobalRow />
        </ErrorBoundary>
      </div>
      {/* A placement and an open lokalitet are mutually exclusive by
          construction (placement.ts), so the bar never carries two sets of
          exits. Keyed on the session so a second `Ny lokalitet` re-seeds from
          the screen. */}
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
