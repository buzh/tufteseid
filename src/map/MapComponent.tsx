import { useAtom, useAtomValue } from 'jotai';
import 'ol/ol.css';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { HeritageInfo } from '../heritageInfo';
import { ErrorBoundary } from '../shared/ErrorBoundary.tsx';
import { SpotSurface } from '../spotControls';
import { terrainWindowLayerEffect } from '../terrain/windowLayer.ts';
import { TerrainSurface } from '../terrainControls';
import styles from './MapComponent.module.css';
import { compareLayerAtomEffect } from './compare/atoms.ts';
import { CompareCurtain } from './compare/CompareCurtain.tsx';
import { viewModeAtom } from './compare/halves.ts';
import { SplitPane } from './compare/SplitPane.tsx';
import { themeLayerEffect } from './layers/atoms.ts';
import { backgroundLayerAtomEffect } from './layers/config/backgroundLayers/atoms.ts';
import { useLidarFootprintsLayer } from './lidarFootprintsLayer.ts';
import { useMap } from './mapHooks.ts';

export const MapComponent = () => {
  const mapRef = useRef<HTMLDivElement>(null);

  const { t } = useTranslation();
  const { setTargetElement } = useMap();
  const viewMode = useAtomValue(viewModeAtom);
  useAtom(themeLayerEffect);
  useAtom(backgroundLayerAtomEffect);
  // Where the LiDAR acquisitions lie, drawn while the ribbon's dataset menu is
  // open — and, whether or not it is, the WFS pass that fills
  // `lidarViewportAtom`, which is what Automatisk and the menu's rows both read.
  useLidarFootprintsLayer();
  // The second ground's stack, in a two-ground view: same resolveStack rules as
  // the background effect above, but into its own `cmp.` namespace, which the
  // background swap does not sweep, and into whichever map the view calls for.
  useAtom(compareLayerAtomEffect);
  // The frame around a standalone terrain analysis — furniture on the map, so
  // it hangs off the atom here rather than off whatever drives the analysis.
  useAtom(terrainWindowLayerEffect);

  useEffect(() => {
    if (mapRef.current) {
      setTargetElement(mapRef.current);
    }
    return () => {
      setTargetElement(null);
    };
  }, [setTargetElement, mapRef]);

  return (
    <div className={styles.root}>
      <ErrorBoundary
        fallback={<p className={styles.error}>{t('map.errorMessage')}</p>}
      >
        {/* One row of viewports. The main map is the whole of it in every view
            but the split, where the second pane takes half and the shared
            `View` keeps the two centred on the same coordinate. */}
        <div className={styles.panes}>
          <div ref={mapRef} id="map" className={styles.map} />
          {viewMode === 'split' && <SplitPane />}
        </div>
        {/* Inside the boundary: the seam is drawn over the map's own rectangle
            and clips the B stack, so it has nothing to say about a map that
            failed to come up. */}
        {viewMode === 'curtain' && <CompareCurtain />}
      </ErrorBoundary>
      {/* Overlays on the map, so they are mounted beside it rather than inside
          the boundary that reports the map itself as lost. A card that throws
          on some shape the register served takes only itself down. */}
      <ErrorBoundary fallback={null} name="kulturminner">
        <HeritageInfo />
      </ErrorBoundary>
      {/* The terrain analysis: the DEM behind it, and the box of settings when
          one is running. Positioned against this rectangle rather than the
          window, so it sits under the band without being told how tall the band
          is. Outside the map's own boundary for the same reason the card is: a
          panel that throws takes only itself down. */}
      <ErrorBoundary fallback={null} name="terreng">
        <TerrainSurface />
      </ErrorBoundary>
      {/* The reader's own records: the saved pins, the short link that opens
          one, and the box a new one is written in. Its own boundary, like the
          two above — a draft that throws on some shape the server returned must
          not take the map, the register or the analysis with it. */}
      <ErrorBoundary fallback={null} name="lokaliteter">
        <SpotSurface />
      </ErrorBoundary>
    </div>
  );
};
