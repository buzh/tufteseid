import { useTranslation } from 'react-i18next';

import styles from './PlaceInfo.module.css';
import { PlaceInfoPopup } from './PlaceInfoPopup';
import { usePlaceInfo } from './usePlaceInfo';

export const PlaceInfo = () => {
  const { t } = useTranslation();
  const { armed, reading, close } = usePlaceInfo();

  return (
    <>
      {armed && (
        <div className={styles.prompt} role="status">
          {t('placeInfo.hint')}
          <span className={styles.promptKey}>{t('placeInfo.escape')}</span>
        </div>
      )}
      <PlaceInfoPopup reading={reading} onClose={close} />
    </>
  );
};
