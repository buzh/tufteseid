import { useAtom } from 'jotai';
import 'ol/ol.css';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from '../shared/ErrorBoundary.tsx';
import styles from './MapComponent.module.css';
import { trackPostitionAtomEffect } from './geolocation/atoms.ts';
import { themeLayerEffect } from './layers/atoms.ts';
import { backgroundLayerAtomEffect } from './layers/config/backgroundLayers/atoms.ts';
import { useMap } from './mapHooks.ts';

export const MapComponent = () => {
  const mapRef = useRef<HTMLDivElement>(null);

  const { t } = useTranslation();
  const { setTargetElement } = useMap();
  useAtom(themeLayerEffect);
  useAtom(trackPostitionAtomEffect);
  useAtom(backgroundLayerAtomEffect);

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
