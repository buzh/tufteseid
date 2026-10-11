import { Tooltip } from '@mantine/core';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useMapOverlay } from '../map/useMapOverlay';
import { formatPoint } from '../spots/geo';
import { Icon, Panel, type MaterialSymbol } from '../ui';
import styles from './PlaceInfo.module.css';
import { readingIsEmpty, type PlaceReading } from './placeReading';

const InfoRow = ({
  icon,
  label,
  children,
}: {
  icon: MaterialSymbol;
  label: string;
  children: ReactNode;
}) => (
  <div className={styles.row}>
    <Tooltip label={label}>
      <span className={styles.rowIcon} tabIndex={0} aria-label={label}>
        <Icon icon={icon} size={16} />
      </span>
    </Tooltip>
    <span className={styles.rowValue}>{children}</span>
  </div>
);

export const PlaceInfoPopup = ({
  reading,
  onClose,
}: {
  reading: PlaceReading | null;
  onClose: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const element = useMapOverlay(reading?.coordinate ?? undefined, {
    stopEvent: true,
    positioning: 'bottom-center',
    offset: [0, -16],
    autoPan: { animation: { duration: 200 }, margin: 24 },
  });

  if (!reading) return null;

  const fmt = (value: number, digits = 0): string =>
    new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: false,
    }).format(value);

  const { telling } = reading;
  const status = reading.busy
    ? t('placeInfo.busy')
    : telling
      ? t('placeInfo.telling', {
          name: telling.name,
          kind: telling.kind,
          metres: fmt(telling.metres),
        })
      : null;

  return createPortal(
    <Panel
      className={styles.popup}
      icon="not_listed_location"
      title={t('placeInfo.title')}
      status={status}
      onClose={onClose}
    >
      <div className={styles.rows}>
        {reading.metresAboveSea !== null && (
          <InfoRow icon="elevation" label={t('placeInfo.elevation')}>
            {t('placeInfo.elevationValue', {
              metres: fmt(reading.metresAboveSea, 1),
            })}
          </InfoRow>
        )}

        <InfoRow icon="my_location" label={t('placeInfo.coordinate')}>
          <div>{formatPoint(reading.lonLat)}</div>
          <div className={styles.rowAside}>
            {t('placeInfo.utm', {
              east: fmt(reading.utm33[0]),
              north: fmt(reading.utm33[1]),
            })}
          </div>
        </InfoRow>

        {reading.municipality && (
          <InfoRow icon="domain" label={t('placeInfo.municipality')}>
            {t('placeInfo.municipalityValue', {
              kommune: reading.municipality.kommunenavn,
              fylke: reading.municipality.fylkesnavn,
            })}
          </InfoRow>
        )}

        {reading.cadastre && (
          <InfoRow icon="square_foot" label={t('placeInfo.cadastre')}>
            {reading.cadastre}
          </InfoRow>
        )}
      </div>

      {reading.places.length > 0 && (
        <div className={styles.places}>
          <div className={styles.placesHead}>{t('placeInfo.nearby')}</div>
          {reading.places.map((place) => (
            <div key={place.key} className={styles.place}>
              <span className={styles.placeName}>{place.name}</span>
              <span className={styles.placeKind}>{place.kind}</span>
              <span className={styles.placeDistance}>
                {t('placeInfo.metres', { metres: fmt(place.metres) })}
              </span>
            </div>
          ))}
        </div>
      )}

      {!reading.busy && readingIsEmpty(reading) && (
        <div className={styles.empty}>{t('placeInfo.nothing')}</div>
      )}
    </Panel>,
    element,
  );
};
