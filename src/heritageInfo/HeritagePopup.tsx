import { Anchor, Badge, Spoiler, Tooltip, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type {
  EnkeltminneSummary,
  HeritageSummary,
} from '../map/featureInfo/heritageSummary';
import { summarizeHeritage } from '../map/featureInfo/heritageSummary';
import {
  kategoriIcon,
  vernBucket,
  VERN_ICONS,
} from '../map/featureInfo/heritageVocabulary';
import { useKulturminnesokStatus } from '../map/featureInfo/kulturminnesok';
import type { FeatureInfoReading } from '../map/featureInfo/types';
import { cx, Icon, Panel, type MaterialSymbol } from '../ui';
import { rollup, summaryIcon, vernToneClass } from './heritageLabels';
import styles from './HeritagePopup.module.css';
import { useMapOverlay } from './useMapOverlay';

const MetaChip = ({
  icon,
  label,
  value,
  tone,
}: {
  icon: MaterialSymbol;
  label: string;
  value: string;
  tone?: string;
}) => (
  <Tooltip label={`${label}: ${value}`}>
    <span className={cx(styles.chip, tone)}>
      <Icon icon={icon} size={14} />
      <span className={styles.chipText}>{value}</span>
    </span>
  </Tooltip>
);

const NestedEnkeltminner = ({
  enkeltminner,
  defaultOpen,
}: {
  enkeltminner: EnkeltminneSummary[];
  defaultOpen: boolean;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={styles.nested}>
      <UnstyledButton
        className={styles.nestedToggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon icon={open ? 'keyboard_arrow_down' : 'chevron_right'} size={16} />
        {t('kulturminner.enkeltminner', { count: enkeltminner.length })}
      </UnstyledButton>
      {open && (
        <div className={styles.nestedList}>
          {enkeltminner.map((em) => {
            const bucket = vernBucket(em.vernetype);
            return (
              <div key={em.key} className={styles.nestedItem}>
                <div className={styles.nestedName}>
                  {em.navn ||
                    em.art ||
                    (em.id
                      ? t('kulturminner.enkeltminneNumber', { id: em.id })
                      : t('kulturminner.enkeltminne'))}
                </div>
                {em.navn && em.art && (
                  <div className={styles.nestedSubtitle}>{em.art}</div>
                )}
                <div className={styles.chips}>
                  {em.kategori && (
                    <MetaChip
                      icon={kategoriIcon(em.kategori)}
                      label={t('kulturminner.kategori')}
                      value={em.kategori}
                    />
                  )}
                  {em.vernetype && (
                    <MetaChip
                      icon={VERN_ICONS[bucket]}
                      label={t('kulturminner.vernestatus')}
                      value={em.vernetype}
                      tone={vernToneClass(bucket)}
                    />
                  )}
                  {em.datering && (
                    <MetaChip
                      icon="history"
                      label={t('kulturminner.datering')}
                      value={em.datering}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const HeritageLinks = ({ summary }: { summary: HeritageSummary }) => {
  const { t } = useTranslation();
  // RA serves a Kulturminnesøk link for every record, but some land on an empty
  // page; the status arrives after this render, so mark rather than withhold.
  const missing = useKulturminnesokStatus(summary.kulturminnesok) === 'missing';

  if (!summary.askeladden && !summary.kulturminnesok) return null;

  return (
    <div className={styles.links}>
      {summary.askeladden && (
        <Anchor
          className={styles.link}
          href={summary.askeladden}
          target="_blank"
          rel="noopener noreferrer"
        >
          Askeladden ↗
        </Anchor>
      )}
      {summary.kulturminnesok &&
        (missing ? (
          <Tooltip label={t('kulturminner.kulturminnesokMangler')}>
            <Anchor
              className={cx(styles.link, styles.linkMissing)}
              href={summary.kulturminnesok}
              target="_blank"
              rel="noopener noreferrer"
            >
              Kulturminnesøk ↗
              <Icon icon="info" size={14} />
              <span className={styles.srOnly}>
                {t('kulturminner.kulturminnesokMangler')}
              </span>
            </Anchor>
          </Tooltip>
        ) : (
          <Anchor
            className={styles.link}
            href={summary.kulturminnesok}
            target="_blank"
            rel="noopener noreferrer"
          >
            Kulturminnesøk ↗
          </Anchor>
        ))}
    </div>
  );
};

const HeritageCard = ({
  summary,
  solo,
}: {
  summary: HeritageSummary;
  solo: boolean;
}) => {
  const { t } = useTranslation();
  const vern = rollup(summary.vernetyper, t('kulturminner.ulikeVernestatus'));
  const datering = rollup(
    summary.dateringer,
    t('kulturminner.flereDateringer'),
  );
  // Registers with no noun of ours fall back to their own layer title.
  const kindLabel = t(`kulturminner.${summary.kind}`, {
    defaultValue: summary.layerTitle,
  });

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <Tooltip
          label={[kindLabel, summary.kategori].filter(Boolean).join(' · ')}
        >
          <span className={styles.kindIcon} tabIndex={0}>
            <Icon icon={summaryIcon(summary)} size={20} />
          </span>
        </Tooltip>
        <div className={styles.cardTitles}>
          <div className={styles.cardTitle}>
            {summary.navn || summary.art || t('kulturminner.fallbackName')}
          </div>
          {summary.navn && summary.art && (
            <div className={styles.cardSubtitle}>{summary.art}</div>
          )}
        </div>
        <span className={styles.cardId}>{summary.id}</span>
      </div>

      <div className={styles.chips}>
        {summary.kind === 'sikringssone' && (
          <Badge size="sm" variant="light" color="yellow">
            {t('kulturminner.sikringssone')}
          </Badge>
        )}
        {vern && (
          <MetaChip
            icon={VERN_ICONS[summary.vernTone]}
            label={t('kulturminner.vernestatus')}
            value={summary.vernedato ? `${vern} (${summary.vernedato})` : vern}
            tone={vernToneClass(summary.vernTone)}
          />
        )}
        {datering && (
          <MetaChip
            icon="history"
            label={t('kulturminner.datering')}
            value={datering}
          />
        )}
        {summary.kommune && (
          <MetaChip
            icon="location_on"
            label={t('kulturminner.kommune')}
            value={summary.kommune}
          />
        )}
        {summary.antallEnkeltminner && (
          <MetaChip
            icon="scatter_plot"
            label={t('kulturminner.antallEnkeltminner')}
            value={summary.antallEnkeltminner}
          />
        )}
        {summary.registrertAv && (
          <MetaChip
            icon="person"
            label={t('kulturminner.registrertAv')}
            value={summary.registrertAv}
          />
        )}
        {summary.registrert && (
          <MetaChip
            icon="event"
            label={t('kulturminner.registrert')}
            value={summary.registrert}
          />
        )}
      </div>

      {summary.informasjon && (
        <Spoiler
          className={styles.description}
          maxHeight={76}
          showLabel={t('kulturminner.descriptionMore')}
          hideLabel={t('kulturminner.descriptionLess')}
        >
          {summary.informasjon}
        </Spoiler>
      )}

      {summary.enkeltminner.length > 0 && (
        <NestedEnkeltminner
          enkeltminner={summary.enkeltminner}
          defaultOpen={solo}
        />
      )}

      <HeritageLinks summary={summary} />
    </div>
  );
};

export const HeritagePopup = ({
  reading,
  onClose,
}: {
  reading: FeatureInfoReading | null;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const element = useMapOverlay(reading?.coordinate ?? undefined, {
    stopEvent: true,
    positioning: 'bottom-center',
    offset: [0, -16],
    autoPan: { animation: { duration: 200 }, margin: 24 },
  });

  if (!reading) return null;
  const summaries = summarizeHeritage(reading.layers);
  if (summaries.length === 0) return null;

  return createPortal(
    <Panel
      className={styles.popup}
      title={t('kulturminner.title', { count: summaries.length })}
      onClose={onClose}
    >
      <div className={styles.cards}>
        {summaries.map((summary) => (
          <HeritageCard
            key={summary.key}
            summary={summary}
            solo={summaries.length === 1}
          />
        ))}
      </div>
    </Panel>,
    element,
  );
};
