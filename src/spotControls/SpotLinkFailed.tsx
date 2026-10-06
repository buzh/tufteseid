import { useAtom } from 'jotai';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { spotLinkFailedAtom } from '../spots/shareLink';
import styles from './SpotBox.module.css';

/** Nothing here is to be acted on, so the notice goes by itself rather than
 *  asking to be dismissed. Long enough to be read after the eye has finished
 *  wondering why the map did not move. */
const SHOWN_MS = 10000;

export const SpotLinkFailed = () => {
  const { t } = useTranslation();
  const [failed, setFailed] = useAtom(spotLinkFailedAtom);

  useEffect(() => {
    if (!failed) return;
    const timer = window.setTimeout(() => setFailed(false), SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [failed, setFailed]);

  if (!failed) return null;

  return (
    <div className={styles.prompt} role="status">
      {t('spots.linkFailed')}
      <span className={styles.promptKey}>{t('spots.linkFailedWhy')}</span>
    </div>
  );
};
