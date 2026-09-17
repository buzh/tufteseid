import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  creditOf,
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
  hint,
  maxLength,
  readOnly,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  /** Under the box, for a field whose label cannot say what it is for. */
  hint?: string;
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

  // A reader gets no empty slots: the placeholder is transparent in read-only,
  // so an unfilled field would be a label with a blank line under it inviting
  // a click that does nothing. The owner keeps it — that is where they fill it.
  if (readOnly && value === '') return null;

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
      {hint && <span className={styles.hint}>{hint}</span>}
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
  const credit = creditOf(locality);

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

      {/* Three empty rows of textarea say "write here" to somebody who cannot.
          The owner keeps the box whether or not it holds anything. */}
      {(canEdit || locality.description) && (
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
      )}

      {/* Absent in show rather than disabled: publishing is a write verb, and
          the state it sets is already a badge on the row behind this dialog.
          The hints below it are advice to whoever is about to press one. */}
      {canEdit && (
        <div className={styles.group}>
          <span className={styles.label}>
            {t('localities.workspace.visibility')}
          </span>
          <Segmented<LocalityVisibility>
            value={locality.visibility}
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
      )}

      {/* The other half of publishing, so it sits under Synlighet: this is
          the name the plate stamps on every image and the Rapportpakke prints
          on its front page. It is a field on the lokalitet rather than a read
          of the account because `users` stays closed to guests — the reader a
          share link exists for cannot look anybody up. */}
      {canEdit && (
        <TextRow
          label={t('localities.workspace.credit')}
          value={locality.credit ?? ''}
          placeholder={t('localities.workspace.creditPlaceholder')}
          hint={t('localities.workspace.creditHint')}
          maxLength={200}
          readOnly={false}
          onCommit={(credit) => onPatch({ credit })}
        />
      )}

      <div className={styles.group}>
        {!canEdit && credit && (
          <Fact label={t('localities.workspace.owner')} value={credit} />
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
