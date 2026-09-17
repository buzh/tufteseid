import { useTranslation } from 'react-i18next';
import { Button, cx, Icon, IconButton, Spinner } from '../ui';
import styles from './BilderPicker.module.css';
import type { PickerApi, PickerCard } from './usePickerRun';

/** What a card says while it has no picture: one line, one icon. */
const Face = ({ card }: { card: PickerCard }) => {
  const { t } = useTranslation();
  if (card.state === 'empty') {
    return (
      <span className={styles.face}>
        <Icon icon="hide_image" size={20} />
        {t('localities.picker.empty')}
      </span>
    );
  }
  if (card.state === 'failed') {
    return (
      <span className={styles.face}>
        <Icon icon="broken_image" size={20} />
        {t('localities.picker.failed')}
      </span>
    );
  }
  return (
    <span className={styles.face}>
      <Spinner size={16} />
      {card.state === 'fetching'
        ? t('localities.picker.fetching')
        : t('localities.picker.waiting')}
    </span>
  );
};

// One frame of the rail. A discarded frame leaves rather than greying out.
const Frame = ({
  card,
  selected,
  onClick,
}: {
  card: PickerCard;
  selected: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={cx(styles.frame, selected && styles.frameOn)}
    aria-pressed={selected}
    title={card.candidate.title}
    onClick={onClick}
  >
    {card.url ? (
      <img src={card.url} alt={card.candidate.title} className={styles.thumb} />
    ) : (
      <span className={styles.thumbFace}>
        {card.state === 'empty' ? (
          <Icon icon="hide_image" size={16} />
        ) : card.state === 'failed' ? (
          <Icon icon="broken_image" size={16} />
        ) : card.state === 'fetching' ? (
          <Spinner size={14} />
        ) : (
          <Icon icon="more_vert" size={16} />
        )}
      </span>
    )}
    {card.state === 'kept' && (
      <span className={styles.frameMark}>
        <Icon icon="check" size={13} filled />
      </span>
    )}
  </button>
);

/**
 * A run of proposals in the bottom slot, one card at a time, keep or discard.
 * Nothing here is a record until `Behold`: closing the run drops the rest, and
 * the ones still queued are never fetched.
 */
export const BilderPicker = ({ picker }: { picker: PickerApi }) => {
  const { t } = useTranslation();
  const { run, active } = picker;
  if (!run) return null;

  const count = run.cards.length;
  const walkable = count > 1;
  const canKeep = active?.state === 'ready' && !picker.keeping;

  return (
    <div className={styles.picker} data-chrome="bottom">
      <div className={styles.head}>
        <span className={styles.title}>
          <Icon
            icon={run.source === 'lidar' ? 'crop_free' : 'satellite_alt'}
            size={16}
          />
          {run.source === 'lidar'
            ? t('localities.picker.headingLidar')
            : t('localities.picker.headingFlyfoto')}
        </span>
        {count > 0 && (
          <span className={styles.progress}>
            {t('localities.picker.progress', { index: run.at + 1, count })}
          </span>
        )}
        <span className={styles.tally}>
          {t('localities.picker.tally', {
            kept: run.kept,
            discarded: run.discarded,
          })}
          {run.skipped > 0 &&
            ` · ${t('localities.picker.skipped', { count: run.skipped })}`}
        </span>
        <span className={styles.spacer} />
        <Button
          size="sm"
          variant="primary"
          leftIcon="check"
          onClick={picker.finish}
        >
          {t('localities.picker.done')}
        </Button>
      </div>

      <div className={styles.stage}>
        <IconButton
          icon="chevron_left"
          size="sm"
          palette="gray"
          disabled={!walkable}
          aria-label={t('localities.bilder.previous')}
          onClick={() => picker.step(-1)}
        />
        <div className={styles.card}>
          {active == null ? (
            <p className={styles.face}>{t('localities.picker.allDone')}</p>
          ) : active.url ? (
            <img
              src={active.url}
              alt={active.candidate.title}
              className={styles.cardImage}
            />
          ) : (
            <Face card={active} />
          )}
          {active?.state === 'kept' && (
            <span className={styles.keptMark}>
              <Icon icon="check" size={14} filled />
              {t('localities.picker.kept')}
            </span>
          )}
        </div>
        <IconButton
          icon="chevron_right"
          size="sm"
          palette="gray"
          disabled={!walkable}
          aria-label={t('localities.bilder.next')}
          onClick={() => picker.step(1)}
        />
      </div>

      {count > 1 && (
        <div className={styles.rail}>
          {run.cards.map((card, i) => (
            <Frame
              key={card.candidate.id}
              card={card}
              selected={i === run.at}
              onClick={() => picker.goTo(i)}
            />
          ))}
        </div>
      )}

      {active && (
        <div className={styles.body}>
          <div className={styles.bodyMain}>
            <div className={styles.cardTitle}>{active.candidate.title}</div>
            {active.candidate.subtitle && (
              <div className={styles.cardSub}>{active.candidate.subtitle}</div>
            )}
          </div>

          <div className={styles.actions}>
            {active.state !== 'kept' && (
              <Button
                size="sm"
                variant="primary"
                leftIcon="library_add"
                disabled={!canKeep}
                onClick={() => void picker.keep()}
              >
                {t('localities.picker.keep')}
              </Button>
            )}
            {/* The run is the only place these pixels exist, so a proposal
                wanted on disk but not in the collection is takeable here. Not
                an anchor at the card's object URL: the file leaving gets the
                provenance plate, which means stamping on the press. */}
            {active.produced && (
              <Button
                size="sm"
                leftIcon="download"
                onClick={() => void picker.download()}
              >
                {t('localities.picker.download')}
              </Button>
            )}
            {active.state !== 'kept' && (
              <Button
                size="sm"
                palette="gray"
                leftIcon="close"
                onClick={picker.discard}
              >
                {t('localities.picker.discard')}
              </Button>
            )}
          </div>
        </div>
      )}

      <p className={styles.hint}>{t('localities.picker.hint')}</p>
    </div>
  );
};
