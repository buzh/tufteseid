import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LocalityPatch,
  LocalityRecord,
  LocalityVisibility,
} from '../api/localities';
import { NoteInput, Segmented } from '../ui';
import { formatDate } from './format';
import styles from './LocalityDetails.module.css';

const VISIBILITY_ORDER: LocalityVisibility[] = ['private', 'limited', 'public'];

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className={styles.fact}>
    <span className={styles.factLabel}>{label}</span>
    <span className={styles.factValue}>{value}</span>
  </div>
);

// Everything you set once and then stop looking at, folded away by
// default. Saves on blur (description) or on click (synlighet); there is
// no dirty-state Lagre button anywhere in the workspace.
export const LocalityDetails = ({
  locality,
  isMine,
  onPatch,
}: {
  locality: LocalityRecord;
  isMine: boolean;
  onPatch: (patch: LocalityPatch) => void;
}) => {
  const { t, i18n } = useTranslation();
  const [description, setDescription] = useState(locality.description ?? '');

  useEffect(() => {
    setDescription(locality.description ?? '');
  }, [locality.description]);

  const commitDescription = () => {
    const next = description.trim();
    if (next === (locality.description ?? '')) return;
    onPatch({ description: next });
  };

  return (
    <div className={styles.root}>
      <div className={styles.group}>
        <span className={styles.label}>
          {t('localities.workspace.description')}
        </span>
        <NoteInput
          value={description}
          onChange={setDescription}
          onBlur={commitDescription}
          placeholder={t('localities.workspace.descriptionPlaceholder')}
          minRows={3}
          disabled={!isMine}
        />
      </div>

      <div className={styles.group}>
        <span className={styles.label}>
          {t('localities.workspace.visibility')}
        </span>
        <Segmented<LocalityVisibility>
          value={locality.visibility}
          disabled={!isMine}
          label={t('localities.workspace.visibility')}
          onChange={(v) => onPatch({ visibility: v })}
          options={VISIBILITY_ORDER.map((v) => ({
            value: v,
            label: t(`localities.visibility.${v}`),
          }))}
        />
        {locality.visibility === 'limited' && (
          <span className={styles.hint}>
            {t('localities.visibility.limitedHint')}
          </span>
        )}
      </div>

      <div className={styles.group}>
        {locality.expand?.owner && (
          <Fact
            label={t('localities.workspace.owner')}
            value={locality.expand.owner.name || locality.expand.owner.id}
          />
        )}
        <Fact
          label={t('localities.workspace.created')}
          value={formatDate(locality.created, i18n.language)}
        />
        <Fact
          label={t('localities.workspace.updated')}
          value={formatDate(locality.updated, i18n.language)}
        />
      </div>
    </div>
  );
};
