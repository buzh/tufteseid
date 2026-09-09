import { useTranslation } from 'react-i18next';
import { KnownKulturminne, KulturminnerResult } from '../api/kulturminnerWfs';
import { Icon, Spinner } from '../ui';
import styles from './KulturminnerSection.module.css';

// Register codes → readable labels. Domain vocabulary from Askeladden,
// left in Norwegian on purpose; unknown codes fall back to the raw code.
const KATEGORI_LABELS: Record<string, string> = {
  'L-ARK': 'Arkeologisk minne',
  'L-BVF': 'Bebyggelse/infrastruktur',
  'L-KRK': 'Kirkested',
};

const VERNETYPE_LABELS: Record<string, string> = {
  AUT: 'Automatisk fredet',
  VED: 'Vedtaksfredet',
  FOR: 'Forskriftsfredet',
  MID: 'Midlertidig fredet',
  LIST: 'Listeført',
  KOM: 'Kommunalt vern',
  UAV: 'Uavklart',
  IKKE: 'Ikke fredet',
  FJE: 'Fjernet',
};

const KulturminneRow = ({ km }: { km: KnownKulturminne }) => {
  const { t } = useTranslation();
  const name = km.navn || t('localities.kulturminner.unnamed');
  const kategori = KATEGORI_LABELS[km.kategori] ?? km.kategori;
  const vern = VERNETYPE_LABELS[km.vernetype] ?? km.vernetype;
  const body = (
    <>
      <span className={styles.main}>
        <span className={styles.name}>
          {name}
          {km.antallEnkeltminner != null && km.antallEnkeltminner > 1
            ? ` (${km.antallEnkeltminner})`
            : ''}
        </span>
        <span className={styles.meta}>
          {[kategori, vern].filter(Boolean).join(' · ')}
        </span>
      </span>
      {km.linkKulturminnesok && (
        <span className={styles.link}>
          <Icon icon="open_in_new" size={14} />
        </span>
      )}
    </>
  );

  return km.linkKulturminnesok ? (
    <a
      className={styles.row}
      href={km.linkKulturminnesok}
      target="_blank"
      rel="noopener noreferrer"
      title={t('localities.kulturminner.openLink')}
    >
      {body}
    </a>
  ) : (
    <div className={styles.row}>{body}</div>
  );
};

export const KulturminnerSection = ({
  result,
  error,
}: {
  result: KulturminnerResult | null;
  error: boolean;
}) => {
  const { t } = useTranslation();

  if (error) {
    return (
      <p className={styles.message}>{t('localities.kulturminner.error')}</p>
    );
  }

  if (!result) {
    return (
      <div className={styles.busy}>
        <Spinner size={14} />
        {t('localities.kulturminner.loading')}
      </div>
    );
  }

  if (result.items.length === 0) {
    return (
      <p className={styles.message}>{t('localities.kulturminner.empty')}</p>
    );
  }

  return (
    <div className={styles.list}>
      {result.items.map((km, i) => (
        <KulturminneRow key={i} km={km} />
      ))}
    </div>
  );
};
