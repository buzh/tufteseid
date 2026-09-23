// The card: everything the registers answered about one point, and the two
// doors out of the app.
//
// Askeladden and Kulturminnesøk are the point of the card as much as the fields
// are — this app reads the register, it does not hold it, and a reader who has
// found something wants the official record next. Riksantikvaren serves a
// Kulturminnesøk link for every record but a fair share of them land on an empty
// page (`kulturminnesok.ts`), so a link that is known to be missing is marked
// rather than withheld: the app has no business hiding the register's own link.
//
// Unlike the tip this is a surface the reader owns — it takes the pointer, it
// scrolls, its text selects, and it stays until it is put down.

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

/** One fact, named. The label is on hover rather than beside the value because
 *  a column of "Kommune: …" reads as a form, and this is a caption. */
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
      {/* Rendered rather than animated shut: the card sizes itself to the
          content, and a closed enkeltminne list is a dozen Tooltips the reader
          cannot reach. */}
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
  // The answer arrives after this render, so the link is marked, never withheld.
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
              {/* The glyph says nothing to a screen reader. */}
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
  // The three registers with no noun of ours fall back to their own name:
  // "Enkeltminne" over a SEFRAK building is the wrong word.
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
        // Four lines is about where `informasjon`'s first sentence lands, and
        // the register writes some of them very long.
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
    // The card is handled, so the map must not see the events it takes.
    stopEvent: true,
    positioning: 'bottom-center',
    offset: [0, -16],
    // A card that opens half off the screen has to be chased; this brings the
    // map to it instead.
    autoPan: { animation: { duration: 200 }, margin: 24 },
  });

  if (!reading) return null;
  const summaries = summarizeHeritage(reading.layers);
  if (summaries.length === 0) return null;

  return createPortal(
    // The fold is worth having on a card pinned to the ground: what the reader
    // wants to see next is usually the relief immediately under it, and the
    // card comes back without asking the register again.
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
