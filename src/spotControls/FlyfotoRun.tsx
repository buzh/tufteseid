// The acquisition box while a run has the map. The proposal itself is on the
// ground, in the footprint and under the spot's drawing, so this is a bar
// along the bottom rather than a box in the corner: keep or discard sits next
// to what is being judged, and nothing here covers it.

import { Button, Loader } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { evidenceTitle, specFacts } from '../evidence/labels';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import styles from './FlyfotoRun.module.css';
import type { FlyfotoRun as Run } from './useFlyfotoRun';

export const FlyfotoRun = ({ run, failed }: { run: Run; failed: boolean }) => {
  const { t, i18n } = useTranslation();

  if (run.phase === 'off') return null;

  const settled = run.tally.kept + run.tally.discarded;
  const card = run.cards[0];
  // Nothing proposed and nothing passed over: never flown here, which is a
  // different answer from having reached the end of the walk.
  const barren = settled === 0 && run.tally.skipped === 0;
  const stuck = card?.state === 'empty' || card?.state === 'failed';
  const pending = card != null && card.state !== 'ready' && !stuck;

  // What the picture is, once there is one; until then, why there is not.
  const note = !card
    ? ''
    : card.state === 'ready'
      ? specFacts(card.spec, i18n.language).join(' · ')
      : card.state === 'empty'
        ? t('evidence.renderEmpty')
        : card.state === 'failed'
          ? t('evidence.renderFailed')
          : t('evidence.rendering');

  const foot = [
    run.tally.skipped > 0 &&
      t('acquire.run.skipped', { count: run.tally.skipped }),
    settled > 0 &&
      t('acquire.run.tally', {
        kept: run.tally.kept,
        discarded: run.tally.discarded,
      }),
    t('acquire.run.hint'),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={styles.bar} role="group" aria-label={t('acquire.flyfoto')}>
      <div className={styles.row}>
        <span className={styles.lead}>
          {run.phase === 'listing' || pending ? (
            <Loader size={16} color="papaya" />
          ) : (
            <Icon icon="photo_camera" size={16} />
          )}
        </span>

        {run.phase === 'listing' ? (
          <span className={styles.title}>{t('flyfotoControls.loading')}</span>
        ) : run.phase === 'failed' ? (
          <span className={styles.title}>{t('flyfotoControls.error')}</span>
        ) : (
          <>
            <span className={styles.progress}>
              {card
                ? t('acquire.run.progress', {
                    index: settled + 1,
                    count: settled + run.cards.length,
                  })
                : barren
                  ? t('acquire.run.none')
                  : t('acquire.run.through')}
            </span>

            {card && (
              <>
                <span className={styles.text}>
                  <span className={styles.title}>
                    {evidenceTitle(card.spec)}
                  </span>
                  <span className={styles.facts}>{note}</span>
                </span>

                {/* Two buttons, always: a proposal with no pixels to keep has
                    the ask again in the same place, so the discard never moves
                    out from under the hand. */}
                {stuck ? (
                  <Button
                    size="compact-xs"
                    variant="default"
                    leftSection={<Icon icon="refresh" size={14} />}
                    onClick={run.again}
                  >
                    {t('evidence.retry')}
                  </Button>
                ) : (
                  <Button
                    size="compact-xs"
                    leftSection={<Icon icon="library_add" size={14} />}
                    disabled={card.state !== 'ready'}
                    loading={run.keeping}
                    onClick={run.keep}
                  >
                    {t('acquire.run.keep')}
                  </Button>
                )}
                <Button
                  size="compact-xs"
                  variant="default"
                  disabled={run.keeping}
                  onClick={run.discard}
                >
                  {t('acquire.run.discard')}
                </Button>
              </>
            )}
          </>
        )}

        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          onClick={run.finish}
        >
          {t('acquire.run.finish')}
        </Button>
      </div>

      {failed && (
        <p className={cx(styles.foot, styles.error)}>{t('evidence.failed')}</p>
      )}
      <p className={styles.foot}>{foot}</p>
    </div>
  );
};
