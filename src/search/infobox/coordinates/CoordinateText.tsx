import { useTranslation } from 'react-i18next';
import { decimalToDMS } from '../../../shared/utils/coordinateCalculations';
import styles from '../InfoBox.module.css';

const formatCoordinateDigit = (value: number, useDMS: boolean) => {
  if (useDMS) {
    const DMSformatedPosition = decimalToDMS(value);
    return [
      value.toFixed(7),
      `${DMSformatedPosition.deg}° ${DMSformatedPosition.min}' ${DMSformatedPosition.sec}"`,
    ];
  } else {
    return [value.toFixed(2)];
  }
};

const CoordindateDigit = ({
  label,
  value,
  useDMS,
}: {
  label: string;
  value: number;
  useDMS: boolean;
}) => (
  <div className={styles.coordRow}>
    <span>{label}:</span>
    <span className={styles.coordValues}>
      {formatCoordinateDigit(value, useDMS).map((text, index) => (
        <span key={index}>{text}</span>
      ))}
    </span>
  </div>
);

export const CoordinateText = ({
  x,
  y,
  isGeographicProjection,
  useDMS,
}: {
  x: number;
  y: number;
  isGeographicProjection: boolean;
  useDMS: boolean;
}) => {
  const { t } = useTranslation();

  // Northing first in a geographic CRS, easting first in a projected one —
  // the axis order each convention is read in.
  const north = (
    <CoordindateDigit
      label={t('infoBox.coordinateSection.north')}
      value={y}
      useDMS={useDMS}
    />
  );
  const east = (
    <CoordindateDigit
      label={t('infoBox.coordinateSection.east')}
      value={x}
      useDMS={useDMS}
    />
  );

  return (
    <div className={styles.coordinates}>
      {isGeographicProjection ? (
        <>
          {north}
          {east}
        </>
      ) : (
        <>
          {east}
          {north}
        </>
      )}
    </div>
  );
};
