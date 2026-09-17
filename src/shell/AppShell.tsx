import { useAtomValue, useSetAtom } from 'jotai';
import { AuthDialog } from '../auth/AuthDialog';
import { FunnSurface } from '../funn/FunnSurface';
import { funnSessionAtom } from '../funn/session';
import { CompareCurtain } from '../map/compare/CompareCurtain';
import { KulturminnerPopup } from '../map/featureInfo/KulturminnerPopup';
import { MapComponent } from '../map/MapComponent';
import { MapToolCards } from '../map/overlay/MapToolCards';
import { SearchComponent } from '../search/SearchComponent';
import { InfoBox } from '../search/infobox/InfoBox';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { cx } from '../ui';
import styles from './AppShell.module.css';
import { bottomSlotAtom } from './bottomSlot';
import { Ribbon } from './Ribbon';
import { useMapSideEffects } from './useMapSideEffects';

export const AppShell = () => {
  const setBottomSlot = useSetAtom(bottomSlotAtom);
  // The session, not the press: the pen can be pressed when the map has no
  // size to frame, and then no surface ever appears (funn/session.ts).
  const drawing = useAtomValue(funnSessionAtom) != null;

  useMapSideEffects();

  return (
    <ErrorBoundary>
      <div className={styles.shell}>
        {/*
          Unconditional, unkeyed, never moved in the tree: useMap's setTarget
          is a no-op when the map already has one, so a second MapComponent
          attaches nothing and blanks the map when the first unmounts.
        */}
        <div className={styles.map}>
          <ErrorBoundary name="MapComponent">
            <MapComponent />
          </ErrorBoundary>
        </div>

        <div className={styles.overlay}>
          {/* First, so it paints under the ribbon and the slots. */}
          <ErrorBoundary name="CompareCurtain">
            <CompareCurtain />
          </ErrorBoundary>

          <div className={styles.ribbon}>
            <Ribbon />
          </div>

          <div className={styles.row}>
            <div className={cx(styles.left, drawing && styles.standDown)}>
              <ErrorBoundary name="SearchComponent">
                <SearchComponent />
              </ErrorBoundary>
              <ErrorBoundary name="MapToolCards">
                <MapToolCards />
              </ErrorBoundary>
            </div>

            {/* Right slot: the search-result infobox and nothing else. */}
            <div className={cx(styles.right, drawing && styles.standDown)}>
              <ErrorBoundary name="InfoBox">
                <InfoBox />
              </ErrorBoundary>
            </div>

            {/* The drawing surface, last so it paints over the two slots it
                stood down, and inside .row so Excalidraw's islands land in
                the gap the chrome leaves rather than under the ribbon
                (funn/FunnCanvas.module.css). Mounted always: it owns the
                session, so it has to outlive it in both directions. */}
            <ErrorBoundary name="FunnSurface">
              <FunnSurface />
            </ErrorBoundary>
          </div>

          {/* The bottom edge, one occupant at a time (bottomSlot.ts). A flex
              child of .overlay after .row, like .ribbon before it, so its
              height shortens .row and the side slots stop above it with no
              media query and no z-index. */}
          <div className={styles.bottom} ref={setBottomSlot} />
        </div>
      </div>

      <ErrorBoundary name="KulturminnerPopup">
        <KulturminnerPopup />
      </ErrorBoundary>
      <ErrorBoundary name="AuthDialog">
        <AuthDialog />
      </ErrorBoundary>
    </ErrorBoundary>
  );
};
