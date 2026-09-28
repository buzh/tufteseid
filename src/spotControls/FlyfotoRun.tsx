// The acquisition box's body while a flyfoto run is on: one proposal at a
// time, kept or discarded, and nothing on screen is a record until it is kept.

import { Alert, Button, Loader } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { evidenceTitle, specFacts } from '../evidence/labels';
import { Icon } from '../ui/Icon';
import styles from './FlyfotoRun.module.css';
import type { FlyfotoRun as Run, RunCard } from './useFlyfotoRun';

/** What the stage says while it has no picture. A `ready` card always has one,
 *  so the spinner covers everything that is not a settled answer. */
const Face = ({ state }: { state: RunCard['state'] }) => {
  const { t } = useTranslation();

  if (state === 'empty') {
    return (
      <span className={styles.face}>
        <Icon icon="hide_image" size={22} />
        {t('evidence.renderEmpty')}
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className={styles.face}>
        <Icon icon="broken_image" size={22} />
        {t('evidence.renderFailed')}
      </span>
    );
  }
  return (
    <span className={styles.face}>
      <Loader size={18} color="papaya" />
      {t('evidence.rendering')}
    </span>
  );
};

export const FlyfotoRun = ({ run }: { run: Run }) => {
  const { t, i18n } = useTranslation();

  if (run.phase === 'off') return null;

  if (run.phase === 'listing') {
    return (
      <p className={styles.line}>
        <Loader size={14} color="papaya" />
        {t('flyfotoControls.loading')}
      </p>
    );
  }

  const settled = run.tally.kept + run.tally.discarded;
  const card = run.cards[0];
  // Nothing proposed and nothing passed over: never flown here, which is a
  // different answer from having reached the end of the walk.
  const barren = settled === 0 && run.tally.skipped === 0;
  const settledCard = card?.state === 'empty' || card?.state === 'failed';

  return (
    <div className={styles.run}>
      {run.phase === 'failed' ? (
        <Alert color="red" p="xs">
          {t('flyfotoControls.error')}
        </Alert>
      ) : (
        <>
          <div className={styles.head}>
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
            <span className={styles.spacer} />
            {settled > 0 && (
              <span>
                {t('acquire.run.tally', {
                  kept: run.tally.kept,
                  discarded: run.tally.discarded,
                })}
              </span>
            )}
          </div>

          {/* Only what the spot has no picture of is proposed, so this line is
              the whole answer to "why so few". */}
          {run.tally.skipped > 0 && (
            <p className={styles.facts}>
              {t('acquire.run.skipped', { count: run.tally.skipped })}
            </p>
          )}

          {card && (
            <>
              <div className={styles.stage}>
                {card.url ? (
                  <img
                    src={card.url}
                    alt={evidenceTitle(card.spec)}
                    className={styles.shot}
                  />
                ) : (
                  <Face state={card.state} />
                )}
              </div>

              <div>
                <div className={styles.title}>{evidenceTitle(card.spec)}</div>
                <div className={styles.facts}>
                  {specFacts(card.spec, i18n.language).join(' · ')}
                </div>
              </div>

              {/* Two buttons, always: a proposal with no pixels to keep has
                  the ask again in the same place, so the discard never moves
                  out from under the hand. */}
              <div className={styles.actions}>
                {settledCard ? (
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
              </div>
            </>
          )}
        </>
      )}

      <Button size="compact-xs" variant="default" onClick={run.finish}>
        {t('acquire.run.finish')}
      </Button>

      <p className={styles.facts}>{t('acquire.run.hint')}</p>
    </div>
  );
};
