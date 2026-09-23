import { Loader, Paper } from '@mantine/core';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { summarizeHeritage } from '../map/featureInfo/heritageSummary';
import type { FeatureInfoReading } from '../map/featureInfo/types';
import { cx, Icon } from '../ui';
import { rollup, summaryIcon, vernToneClass } from './heritageLabels';
import styles from './HeritageTip.module.css';
import { useMapOverlay } from './useMapOverlay';

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
      <div className={styles.hint}>{t('kulturminner.klikkForDetaljer')}</div>
    </Paper>,
    element,
  );
};
