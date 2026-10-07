import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import { spotLinkFailedAtom } from '../spots/shareLink';
import styles from './SpotBox.module.css';

export const SpotLinkFailed = () => {
  const { t } = useTranslation();
  const failed = useAtomValue(spotLinkFailedAtom);

  if (!failed) return null;

  return (
    <div className={styles.prompt} role="status">
      {t('spots.linkFailed')}
      <span className={styles.promptKey}>{t('spots.linkFailedWhy')}</span>
    </div>
  );
};
