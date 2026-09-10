import { useAtomValue, useSetAtom } from 'jotai';
import { AuthDialog } from '../auth/AuthDialog';
import { BottomDrawToolSelector } from '../draw/BottomDrawToolSelector';
import { funnDraftActiveAtom } from '../localities/atoms';
import { CompareCurtain } from '../map/compare/CompareCurtain';
import { KulturminnerPopup } from '../map/featureInfo/KulturminnerPopup';
import { MapComponent } from '../map/MapComponent';
import { MapToolCards } from '../map/overlay/MapToolCards';
import { SearchComponent } from '../search/SearchComponent';
import { InfoBox } from '../search/infobox/InfoBox';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { useIsMobileScreen } from '../shared/hooks';
import styles from './AppShell.module.css';
import { dockSlotAtom } from './dockSlot';
import { Ribbon } from './Ribbon';
import { TerrainDock } from './TerrainDock';
import { useMapSideEffects } from './useMapSideEffects';

export const AppShell = () => {
  const isMobile = useIsMobileScreen();
  const funnDraftActive = useAtomValue(funnDraftActiveAtom);
  const setDockSlot = useSetAtom(dockSlotAtom);

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

            {/* Right slot: the dock column. The search-result infobox stacks
                above whichever dock is live, and `LocalityRibbon` portals the
                lokalitet dock in here (see dockSlot.ts) — hence the ref. */}
            <div className={styles.right} ref={setDockSlot}>
              <ErrorBoundary name="InfoBox">
                <InfoBox />
              </ErrorBoundary>
              <ErrorBoundary name="TerrainDock">
                <TerrainDock />
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
