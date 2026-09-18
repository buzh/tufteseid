import { useAtom } from 'jotai';
import 'ol/ol.css';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from '../shared/ErrorBoundary.tsx';
import { terrainWindowLayerEffect } from '../terrain/windowLayer.ts';
import styles from './MapComponent.module.css';
import { compareLayerAtomEffect } from './compare/atoms.ts';
import { themeLayerEffect } from './layers/atoms.ts';
import { backgroundLayerAtomEffect } from './layers/config/backgroundLayers/atoms.ts';
import { useMap } from './mapHooks.ts';

export const MapComponent = () => {
  const mapRef = useRef<HTMLDivElement>(null);

  const { t } = useTranslation();
  const { setTargetElement } = useMap();
  useAtom(themeLayerEffect);
  useAtom(backgroundLayerAtomEffect);
  // The compare curtain's B stack: same resolveStack rules as the background
  // effect above, but into its own `cmp.` namespace, which the background
  // swap does not sweep.
  useAtom(compareLayerAtomEffect);
  // The frame around a standalone terrain analysis — furniture on the map, so
  // it hangs off the atom here rather than off the terrain hook in the ribbon.
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
    </div>
  );
};
