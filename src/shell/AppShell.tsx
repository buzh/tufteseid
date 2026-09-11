import { useSetAtom } from 'jotai';
import { AuthDialog } from '../auth/AuthDialog';
import { CompareCurtain } from '../map/compare/CompareCurtain';
import { KulturminnerPopup } from '../map/featureInfo/KulturminnerPopup';
import { MapComponent } from '../map/MapComponent';
import { MapToolCards } from '../map/overlay/MapToolCards';
import { SearchComponent } from '../search/SearchComponent';
import { InfoBox } from '../search/infobox/InfoBox';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import styles from './AppShell.module.css';
import { bottomSlotAtom } from './bottomSlot';
import { Ribbon } from './Ribbon';
import { useMapSideEffects } from './useMapSideEffects';

export const AppShell = () => {
  const setBottomSlot = useSetAtom(bottomSlotAtom);

  useMapSideEffects();

  return (
    <ErrorBoundary>
      <div className={styles.shell}>
        {/*
          Unconditional, unkeyed, and never moved in the tree. useMap's
          setTarget is a no-op when the map already has one, so a second
          MapComponent silently attaches nothing and then blanks the map
          when the first one unmounts.
        */}
        <div className={styles.map}>
          <ErrorBoundary name="MapComponent">
            <MapComponent />
          </ErrorBoundary>
        </div>

        <div className={styles.overlay}>
          {/* First, so it paints under the ribbon and the slots: the curtain
              edge belongs to the map, and the chrome floats over the map. */}
          <ErrorBoundary name="CompareCurtain">
            <CompareCurtain />
          </ErrorBoundary>

          <div className={styles.ribbon}>
            <Ribbon />
          </div>

          <div className={styles.row}>
            {/* The left slot used to arbitrate between a MapTool card and
                the lokalitet workspace. The workspace is in the ribbon now,
                so there is nothing left to arbitrate and both render. */}
            <div className={styles.left}>
              <ErrorBoundary name="SearchComponent">
                <SearchComponent />
              </ErrorBoundary>
              <ErrorBoundary name="MapToolCards">
                <MapToolCards />
              </ErrorBoundary>
            </div>

            {/* Right slot: the search-result infobox, and nothing else. Two
                docks have now left this column — Terrenganalyse's, whose knobs
                are on the ribbon, and the lokalitet's, whose contents are on
                the lokalitet row and the bottom edge (§6). What is left is the
                one thing that was never chrome: the readout for a point you
                asked about. */}
            <div className={styles.right}>
              <ErrorBoundary name="InfoBox">
                <InfoBox />
              </ErrorBoundary>
            </div>
          </div>

          {/* The bottom edge — the filmstrip, the edit carousel, a picker run
              or the draw bar, one at a time (see bottomSlot.ts). A flex child
              of .overlay after .row, exactly like .ribbon before it: the
              slot's own height then shortens .row, so the infobox column
              stops above it with no media query and no z-index. */}
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
