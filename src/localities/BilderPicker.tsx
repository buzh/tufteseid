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

/*
 * One frame of the rail.
 *
 * The rail is what makes the fetch policy legible: card two is visibly
 * spinning while you judge card one, and card five visibly has not started.
 * It is also where discarding shows — the frame leaves, rather than greying
 * out, so twelve proposals become the four you are still considering.
 */
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
 * The picker carousel (docs/lokalitet-view.md §4.3).
 *
 * A run of proposals in the bottom slot, one card at a time, each keep or
 * discard. It **borrows** the slot from the lokalitet carousel rather than
 * being a fifth occupant of it, so the one-surface rule holds unchanged — and
 * it is deliberately not dressed like the carousel it displaced, because
 * "these are proposals" and "these are yours" must not look alike. Hence the
 * header naming the run and its progress, the tally, and `Ferdig`.
 *
 * Nothing here is a record until you press `Behold`. The rest were never
 * records: closing the run drops them, and the ones still in the queue are
 * never fetched at all.
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
            {/* The viewer's PNG download, which is where it went: the run is
                the only place these pixels exist, so a proposal you want on
                disk but not in the collection has to be takeable here. */}
            {active.produced && active.url && (
              <a
                className={styles.download}
                href={active.url}
                download={active.produced.filename}
              >
                <Icon icon="download" size={16} />
                {t('localities.picker.download')}
              </a>
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
