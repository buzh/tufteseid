import { useTranslation } from 'react-i18next';

import styles from './SpotBox.module.css';

export const SpotPlacePrompt = () => {
  const { t } = useTranslation();
  return (
    <div className={styles.prompt} role="status">
      {t('spots.placeHint')}
      <span className={styles.promptKey}>{t('spots.placeEscape')}</span>
    </div>
  );
};
