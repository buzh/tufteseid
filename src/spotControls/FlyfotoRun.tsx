// The acquisition box while a run has the map. The proposal itself is on the
// ground, in the footprint and under the spot's drawing, so this is a bar
// along the bottom rather than a box in the corner: keep or discard sits next
// to what is being judged, and nothing here covers it.

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
  // Excalidraw binds its own single-letter shortcuts while the canvas is up.
  const penHasTheMap = useAtomValue(sketchSessionAtom) !== null;

  const settled = run.tally.kept + run.tally.discarded;
  const card = run.cards[0];
  // Nothing proposed and nothing passed over: never flown here, which is a
  // different answer from having reached the end of the walk.
  const barren = settled === 0 && run.tally.skipped === 0;
  const stuck = card?.state === 'empty' || card?.state === 'failed';
  const pending = card != null && card.state !== 'ready' && !stuck;

  // What yes does: ask again when there are no pixels to keep, keep them when
  // there are. Null where the button is disabled, so the key can do no more
  // than the hand.
  const yes = !card
    ? null
    : stuck
      ? run.again
      : card.state === 'ready' && !run.keeping
        ? run.keep
        : null;
  const no = !card || run.keeping ? null : run.discard;

  // The answer is a keystroke as well as a button: the reader is out on the
  // ground zooming and panning over the proposal, and coming back to the bar
  // for every acquisition is the walk's whole cost.
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

  // What the picture is, once there is one; until then, why there is not.
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

        {/* Held against the right edge of a bar of fixed width, so an answer
            is in the same place whatever the acquisition is called. Two
            buttons, always: a proposal with no pixels to keep has the ask
            again where the yes was, so the no never moves out from under the
            hand. */}
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
