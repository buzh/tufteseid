import { useTranslation } from 'react-i18next';
import { DrawControls } from '../draw/drawControls/DrawControls';
import { Alert, Button, Input, NoteInput } from '../ui';
import styles from './FunnDraft.module.css';

/**
 * The band that is up while you are drawing.
 *
 * Not a form any more. There is no Lagre and nothing to discard: the record
 * is created by the first finished shape and every change after that is
 * written back on its own, so the title and note here edit a funn that
 * already exists — on blur, like a row in the list — and the only button is
 * the one that puts the pen down.
 *
 * What is left to say is therefore *state*: whether the drawing has been
 * kept yet, and whether it has wandered outside the lokalitet's rectangle.
 */
export const FunnDraft = ({
  editing,
  saved,
  title,
  note,
  saving,
  error,
  outside,
  onTitle,
  onNote,
  onCommit,
  onGrow,
  onDone,
}: {
  /** Opened from "Rediger tegningen" rather than from a blank pen. */
  editing: boolean;
  /** A record exists — i.e. at least one shape has been finished. */
  saved: boolean;
  title: string;
  note: string;
  saving: boolean;
  error: string | null;
  /** The drawing sticks out of the lokalitet's rectangle. */
  outside: boolean;
  onTitle: (v: string) => void;
  onNote: (v: string) => void;
  onCommit: () => void;
  onGrow: () => void;
  onDone: () => void;
}) => {
  const { t } = useTranslation();

  return (
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
          onBlur={onCommit}
          placeholder={t('localities.funn.draft.titlePlaceholder')}
          maxLength={200}
        />
        <NoteInput
          value={note}
          onChange={onNote}
          onBlur={onCommit}
          placeholder={t('localities.funn.draft.notePlaceholder')}
        />

        {outside && (
          <Alert tone="warning">
            <div className={styles.grow}>
              <span>{t('localities.funn.growHint')}</span>
              <Button size="xs" variant="secondary" onClick={onGrow}>
                {t('localities.funn.growConfirmAction')}
              </Button>
            </div>
          </Alert>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <span className={styles.state}>
            {saving
              ? t('localities.workspace.saving')
              : saved
                ? t('localities.funn.draft.saved')
                : t('localities.funn.draft.pending')}
          </span>
          <Button size="sm" variant="primary" onClick={onDone}>
            {t('localities.funn.draft.done')}
          </Button>
        </div>
      </div>
    </div>
  );
};
