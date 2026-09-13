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
  // The session, not "the user pressed the pen": the surface is the thing
  // being made room for, and the pen can be pressed at a moment the map has
  // no size to frame, in which case there is never a surface (funn/session.ts).
  const drawing = useAtomValue(funnSessionAtom) != null;

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
            <div className={cx(styles.left, drawing && styles.standDown)}>
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
            <div className={cx(styles.right, drawing && styles.standDown)}>
              <ErrorBoundary name="InfoBox">
                <InfoBox />
              </ErrorBoundary>
            </div>

            {/* The drawing surface, last so it paints over the two slots it
                just stood down — and inside .row rather than as a layer of
                its own over the map, so that Excalidraw's islands land in the
                gap the chrome leaves instead of under the ribbon
                (funn/FunnCanvas.module.css). Renders nothing until the pen
                goes down; it owns the session, so it has to outlive it in
                both directions. */}
            <ErrorBoundary name="FunnSurface">
              <FunnSurface />
            </ErrorBoundary>
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
