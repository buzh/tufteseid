import { useAtomValue } from 'jotai';
import { AuthDialog } from '../auth/AuthDialog';
import { BottomDrawToolSelector } from '../draw/BottomDrawToolSelector';
import { funnDraftActiveAtom } from '../localities/atoms';
import { KulturminnerPopup } from '../map/featureInfo/KulturminnerPopup';
import { MapComponent } from '../map/MapComponent';
import { MapToolCards } from '../map/overlay/MapToolCards';
import { SearchComponent } from '../search/SearchComponent';
import { InfoBox } from '../search/infobox/InfoBox';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { useIsMobileScreen } from '../shared/hooks';
import styles from './AppShell.module.css';
import { Ribbon } from './Ribbon';
import { useMapSideEffects } from './useMapSideEffects';

export const AppShell = () => {
  const isMobile = useIsMobileScreen();
  const funnDraftActive = useAtomValue(funnDraftActiveAtom);

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

            {/* Right slot: coordinate readout / search-result infobox. */}
            <div className={styles.right}>
              <ErrorBoundary name="InfoBox">
                <InfoBox />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      </div>

      {isMobile && funnDraftActive && (
        <ErrorBoundary name="BottomDrawToolSelector">
          <BottomDrawToolSelector />
        </ErrorBoundary>
      )}
      <ErrorBoundary name="KulturminnerPopup">
        <KulturminnerPopup />
      </ErrorBoundary>
      <ErrorBoundary name="AuthDialog">
        <AuthDialog />
      </ErrorBoundary>
    </ErrorBoundary>
  );
};
