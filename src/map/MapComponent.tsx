import { useAtom, useAtomValue } from 'jotai';
import 'ol/ol.css';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { HeritageInfo } from '../heritageInfo';
import { ErrorBoundary } from '../shared/ErrorBoundary.tsx';
import { SpotSurface } from '../spotControls';
import { spotFootprintLayerEffect } from '../spots/footprintLayer.ts';
import { terrainWindowLayerEffect } from '../terrain/windowLayer.ts';
import { TerrainSurface } from '../terrainControls';
import styles from './MapComponent.module.css';
import { compareLayerAtomEffect } from './compare/atoms.ts';
import { CompareCurtain } from './compare/CompareCurtain.tsx';
import { viewModeAtom } from './compare/halves.ts';
import { SplitPane } from './compare/SplitPane.tsx';
import { useCvatHintLayer } from './cvatHintLayer.ts';
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
  // Also runs the WFS pass that fills `lidarViewportAtom`.
  useLidarFootprintsLayer();
  useCvatHintLayer();
  useAtom(compareLayerAtomEffect);
  useAtom(terrainWindowLayerEffect);
  useAtom(spotFootprintLayerEffect);

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
        <div className={styles.panes}>
          <div ref={mapRef} id="map" className={styles.map} />
          {viewMode === 'split' && <SplitPane />}
        </div>
        {viewMode === 'curtain' && <CompareCurtain />}
      </ErrorBoundary>
      <ErrorBoundary fallback={null} name="kulturminner">
        <HeritageInfo />
      </ErrorBoundary>
      <ErrorBoundary fallback={null} name="terreng">
        <TerrainSurface />
      </ErrorBoundary>
      <ErrorBoundary fallback={null} name="lokaliteter">
        <SpotSurface />
      </ErrorBoundary>
    </div>
  );
};
