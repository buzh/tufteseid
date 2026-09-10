import { useTranslation } from 'react-i18next';
import { Place } from '../../types/searchTypes';
import styles from './InfoBox.module.css';

interface PlaceInfoProps {
  place: Place;
}

export const PlaceInfo = ({ place }: PlaceInfoProps) => {
  const { t } = useTranslation();

  return (
    <div className={styles.place}>
      <div className={styles.placeFacts}>
        <span className={styles.placeName}>{place.name}</span>
        <span className={styles.small}>
          {t('placeInfo.locationNumber')}: {place.placeNumber}
        </span>
        <span className={styles.small}>
          {t('placeInfo.nameObjectType')}: {place.placeType}
        </span>
      </div>
      <a
        className={styles.link}
        href={`https://stadnamn.kartverket.no/fakta/${place.placeNumber}`}
        target="_blank"
        rel="noreferrer"
      >
        {t('placeInfo.moreInfo')}
      </a>
    </div>
  );
};
