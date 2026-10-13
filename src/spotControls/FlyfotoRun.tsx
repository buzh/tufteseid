

import { Button, Loader } from '@mantine/core';
import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { evidenceTitle, specFacts } from '../evidence/labels';
import { sketchSessionAtom } from '../sketch/session';
import { cx } from '../ui/cx';
import { TYPING_SURFACE } from '../ui/hints';
import { Icon } from '../ui/Icon';
import styles from './FlyfotoRun.module.css';
import type { FlyfotoRun as Run } from './useFlyfotoRun';

export const FlyfotoRun = ({ run, failed }: { run: Run; failed: boolean }) => {
  const { t } = useTranslation();

  const penHasTheMap = useAtomValue(sketchSessionAtom) !== null;

  const settled = run.tally.kept + run.tally.discarded;
  const card = run.cards[0];

  const barren = settled === 0 && run.tally.skipped === 0;
  const stuck = card?.state === 'empty' || card?.state === 'failed';
  const pending = card != null && card.state !== 'ready' && !stuck;

  const yes = !card
    ? null
    : stuck
      ? run.again
      : card.state === 'ready' && !run.keeping
        ? run.keep
        : null;
  const no = !card || run.keeping ? null : run.discard;

  useEffect(() => {
    if (penHasTheMap) return;
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key !== 'j' && key !== 'n') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(TYPING_SURFACE)) return;
      if (key === 'j') yes?.();
      else no?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [penHasTheMap, yes, no]);

  if (run.phase === 'off') return null;

  const note = !card
    ? ''
    : card.state === 'ready'
      ? specFacts(card.spec).join(' · ')
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
              <span className={styles.text}>
                <span className={styles.title}>{evidenceTitle(card.spec)}</span>
                <span className={styles.facts}>{note}</span>
              </span>
            )}
          </>
        )}

        {}
        <div className={styles.actions}>
          {card &&
            (stuck ? (
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
                title={t('acquire.run.keepTitle')}
                disabled={card.state !== 'ready'}
                loading={run.keeping}
                onClick={run.keep}
              >
                {t('acquire.run.keep')}
              </Button>
            ))}
          {card && (
            <Button
              size="compact-xs"
              variant="default"
              title={t('acquire.run.discardTitle')}
              disabled={run.keeping}
              onClick={run.discard}
            >
              {t('acquire.run.discard')}
            </Button>
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
      </div>

      {failed && (
        <p className={cx(styles.foot, styles.error)}>{t('evidence.failed')}</p>
      )}
      <p className={styles.foot}>{foot}</p>
    </div>
  );
};
