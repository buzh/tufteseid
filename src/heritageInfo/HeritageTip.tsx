// The mouseover: what is under the pointer, in as few words as the register
// will allow, anchored to the ground rather than to the cursor.
//
// It is a readout and never a target — `pointer-events: none` all the way
// through, so it cannot be hovered, clicked or dragged, and the map underneath
// it stays the thing being handled. Everything a reader might want to keep,
// select or follow is in the card a click opens.
//
// It also stands in for the wait on that click: `kart.ra.no` can take seconds,
// and a click that shows nothing until it answers reads as a click that missed.

import { Loader, Paper } from '@mantine/core';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { summarizeHeritage } from '../map/featureInfo/heritageSummary';
import type { FeatureInfoReading } from '../map/featureInfo/types';
import { cx, Icon } from '../ui';
import { rollup, summaryIcon, vernToneClass } from './heritageLabels';
import styles from './HeritageTip.module.css';
import { useMapOverlay } from './useMapOverlay';

/** Past this the tip is a panel, and a panel that cannot be read at rest is
 *  worse than a count. Dense heritage areas hit it often. */
const MAX_ROWS = 3;

export const HeritageTip = ({
  reading,
  pending,
}: {
  reading: FeatureInfoReading | null;
  pending: [number, number] | null;
}) => {
  const { t } = useTranslation();
  const position = reading?.coordinate ?? pending ?? undefined;
  const element = useMapOverlay(position, {
    // Below the card, and out of the way of the map's own gestures.
    stopEvent: false,
    positioning: 'bottom-left',
    offset: [14, -14],
  });

  if (!position) return null;

  if (!reading) {
    return createPortal(
      <Paper className={cx(styles.tip, styles.waiting)} withBorder shadow="md">
        <Loader size="xs" type="dots" />
        <span className={styles.waitingLabel}>{t('kulturminner.laster')}</span>
      </Paper>,
      element,
    );
  }

  const summaries = summarizeHeritage(reading.layers);
  if (summaries.length === 0) return null;
  const shown = summaries.slice(0, MAX_ROWS);
  const hidden = summaries.length - shown.length;

  return createPortal(
    <Paper className={styles.tip} withBorder shadow="md">
      {shown.map((summary) => {
        const vern = rollup(
          summary.vernetyper,
          t('kulturminner.ulikeVernestatus'),
        );
        return (
          <div key={summary.key} className={styles.row}>
            <Icon
              icon={summaryIcon(summary)}
              size={16}
              className={styles.rowIcon}
            />
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>
                {summary.navn || summary.art || t('kulturminner.fallbackName')}
              </span>
              {summary.navn && summary.art && (
                <span className={styles.rowSubtitle}>{summary.art}</span>
              )}
            </div>
            {vern && (
              <span
                className={cx(styles.tone, vernToneClass(summary.vernTone))}
              >
                {vern}
              </span>
            )}
          </div>
        );
      })}
      {hidden > 0 && (
        <div className={styles.overflow}>
          {t('kulturminner.flereHer', { count: hidden })}
        </div>
      )}
      {/* The tip cannot be clicked, so it has to say where the rest is. */}
      <div className={styles.hint}>{t('kulturminner.klikkForDetaljer')}</div>
    </Paper>,
    element,
  );
};
