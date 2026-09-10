import { useTranslation } from 'react-i18next';
import { DrawControls } from '../draw/drawControls/DrawControls';
import { Button, Input, NoteInput } from '../ui';
import styles from './FunnDraft.module.css';

// The new-funn / edit-the-drawing form. Unlike an existing row (which
// saves on blur) a draft is a commit-or-discard form: there is no record
// yet to fall back to, and the drawing on the map has to be cleaned up
// either way.
export const FunnDraft = ({
  editing,
  title,
  note,
  saving,
  error,
  onTitle,
  onNote,
  onSave,
  onCancel,
}: {
  editing: boolean;
  title: string;
  note: string;
  saving: boolean;
  error: string | null;
  onTitle: (v: string) => void;
  onNote: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) => {
  const { t } = useTranslation();
  return (
    // Two columns in the ribbon row: what you draw on the left, what you
    // call it on the right. Stacked they pushed the name field below the
    // fold of a surface that is already competing with the map.
    <div className={styles.root}>
      <div className={styles.draw}>
        <p className={styles.instructions}>
          {t(
            editing
              ? 'localities.funn.draft.instructionsEdit'
              : 'localities.funn.draft.instructions',
          )}
        </p>
        <DrawControls />
      </div>

      <div className={styles.form}>
        <Input
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder={t('localities.funn.draft.titlePlaceholder')}
          maxLength={200}
        />
        <NoteInput
          value={note}
          onChange={onNote}
          placeholder={t('localities.funn.draft.notePlaceholder')}
        />

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <Button size="sm" palette="gray" onClick={onCancel}>
            {t('localities.funn.draft.cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={onSave}
            disabled={saving || title.trim().length === 0}
          >
            {saving
              ? t('localities.workspace.saving')
              : t('localities.funn.draft.save')}
          </Button>
        </div>
      </div>
    </div>
  );
};
