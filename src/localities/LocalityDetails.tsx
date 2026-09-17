import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LocalityPatch,
  LocalityRecord,
  LocalityVisibility,
} from '../api/localities';
import { Button, Input, NoteInput, Segmented } from '../ui';
import { formatBboxArea, formatBboxCentre, formatDate } from './format';
import styles from './LocalityDetails.module.css';
import { fetchLocalityContext } from './localityContext';

const VISIBILITY_ORDER: LocalityVisibility[] = ['private', 'limited', 'public'];

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className={styles.fact}>
    <span className={styles.factLabel}>{label}</span>
    <span className={styles.factValue}>{value}</span>
  </div>
);

// A labelled one-line field that commits on blur, over local draft state so
// typing is not fighting the record's value.
const TextRow = ({
  label,
  value,
  placeholder,
  maxLength,
  readOnly,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  maxLength: number;
  // Read-only rather than disabled: in show this is every field, the owner's
  // included. See `.control:read-only` in Field.module.css.
  readOnly: boolean;
  onCommit: (next: string) => void;
}) => {
  const [draft, setDraft] = useState(value);

  // Follows the record: the refresh button below rewrites all three at once.
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = draft.trim();
    if (next === value) return;
    onCommit(next);
  };

  return (
    <div className={styles.group}>
      <span className={styles.label}>{label}</span>
      <Input
        value={draft}
        readOnly={readOnly}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // Enter commits via blur. Escape reverts without blurring: a
          // synchronous blur() would still see this render's stale draft.
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setDraft(value);
        }}
      />
    </div>
  );
};

// Sted / Kommune / Matrikkel are pre-filled from the public registers when the
// rectangle is first framed and are the user's afterwards; only the refresh
// button overwrites them. Koordinater is not a field — it is computed from the
// bbox per render, so "Juster området" cannot leave it stale.
const LocationGroup = ({
  locality,
  canEdit,
  onPatch,
}: {
  locality: LocalityRecord;
  canEdit: boolean;
  onPatch: (patch: LocalityPatch) => void;
}) => {
  const { t, i18n } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const context = await fetchLocalityContext(locality.bbox);
      onPatch({
        place: context.place,
        municipality: context.municipality,
        matrikkel: context.matrikkel,
      });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <TextRow
        label={t('localities.workspace.place')}
        value={locality.place ?? ''}
        placeholder={t('localities.workspace.placePlaceholder')}
        maxLength={200}
        readOnly={!canEdit}
        onCommit={(place) => onPatch({ place })}
      />
      <TextRow
        label={t('localities.workspace.municipality')}
        value={locality.municipality ?? ''}
        placeholder={t('localities.workspace.municipalityPlaceholder')}
        maxLength={200}
        readOnly={!canEdit}
        onCommit={(municipality) => onPatch({ municipality })}
      />
      <TextRow
        label={t('localities.workspace.matrikkel')}
        value={locality.matrikkel ?? ''}
        placeholder={t('localities.workspace.matrikkelPlaceholder')}
        maxLength={500}
        readOnly={!canEdit}
        onCommit={(matrikkel) => onPatch({ matrikkel })}
      />

      <div className={styles.group}>
        <Fact
          label={t('localities.workspace.coordinates')}
          value={formatBboxCentre(locality.bbox)}
        />
        <Fact
          label={t('localities.workspace.area')}
          value={formatBboxArea(locality.bbox, i18n.language)}
        />
        {canEdit && (
          <>
            <Button
              className={styles.refresh}
              variant="secondary"
              size="xs"
              leftIcon="refresh"
              disabled={refreshing}
              onClick={refresh}
            >
              {refreshing
                ? t('localities.workspace.refreshingContext')
                : t('localities.workspace.refreshContext')}
            </Button>
            <span className={styles.hint}>
              {t('localities.workspace.refreshContextHint')}
            </span>
          </>
        )}
      </div>
    </>
  );
};

// Everything you set once and then stop looking at. Commits on blur (the text
// fields) or on click (synlighet), into the edit transaction's buffer.
export const LocalityDetails = ({
  locality,
  canEdit,
  onPatch,
}: {
  locality: LocalityRecord;
  canEdit: boolean;
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
      <LocationGroup locality={locality} canEdit={canEdit} onPatch={onPatch} />

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
          readOnly={!canEdit}
        />
      </div>

      <div className={styles.group}>
        <span className={styles.label}>
          {t('localities.workspace.visibility')}
        </span>
        <Segmented<LocalityVisibility>
          value={locality.visibility}
          disabled={!canEdit}
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
        {/* Public means the open web, images included — not just signed-in
            users — so say so before it is true. */}
        {locality.visibility === 'public' && (
          <span className={styles.hint}>
            {t('localities.visibility.publicHint')}
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
