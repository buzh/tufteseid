import { useAtom } from 'jotai';
import 'ol/ol.css';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { HeritageInfo } from '../heritageInfo';
import { ErrorBoundary } from '../shared/ErrorBoundary.tsx';
import { terrainWindowLayerEffect } from '../terrain/windowLayer.ts';
import styles from './MapComponent.module.css';
import { compareLayerAtomEffect } from './compare/atoms.ts';
import { themeLayerEffect } from './layers/atoms.ts';
import { backgroundLayerAtomEffect } from './layers/config/backgroundLayers/atoms.ts';
import { useLidarFootprintsLayer } from './lidarFootprintsLayer.ts';
import { useMap } from './mapHooks.ts';

export const MapComponent = () => {
  const mapRef = useRef<HTMLDivElement>(null);

  const { t } = useTranslation();
  const { setTargetElement } = useMap();
  useAtom(themeLayerEffect);
  useAtom(backgroundLayerAtomEffect);
  // Where the LiDAR acquisitions lie, drawn while the ribbon's dataset menu is
  // open — and, whether or not it is, the WFS pass that fills
  // `lidarViewportAtom`, which is what Automatisk and the menu's rows both read.
  useLidarFootprintsLayer();
  // The compare curtain's B stack: same resolveStack rules as the background
  // effect above, but into its own `cmp.` namespace, which the background
  // swap does not sweep.
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
        <div ref={mapRef} id="map" className={styles.map} />
      </ErrorBoundary>
      {/* Overlays on the map, so they are mounted beside it rather than inside
          the boundary that reports the map itself as lost. A card that throws
          on some shape the register served takes only itself down. */}
      <ErrorBoundary fallback={null} name="kulturminner">
        <HeritageInfo />
      </ErrorBoundary>
    </div>
  );
};
