import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LidarViewportEntry } from '../../map/layers/config/backgroundLayers/lidarRelevance';
import { Button, CountBadge, IconButton, Popover, Spinner } from '../../ui';
import { PulldownDisclosure, PulldownItem } from '../Pulldown';
import styles from '../Pulldown.module.css';
import { useGroundRingHint } from '../visningRing';
import { LidarFilters } from './LidarFilters';
import type { LidarControls } from './useLidarControls';

// How much of the current screen this project's footprint paints, which is
// what the list is ordered by.
const coverageLabel = (ratio: number): string | null =>
  ratio <= 0 ? null : ratio < 0.01 ? '<1%' : `${Math.round(ratio * 100)}%`;

const projectMeta = (entry: LidarViewportEntry): string =>
  [
    entry.project.year != null ? String(entry.project.year) : null,
    entry.project.pointDensity,
    coverageLabel(entry.areaRatio),
  ]
    .filter((s): s is string => !!s && s.length > 0)
    .join(' · ');

// The glyph on whichever row Automatisk has landed on, and the chip's left
// icon, so the symbol means the same open or shut.
const AUTO_ICON = 'bolt';

// The national mosaic, one flight, or Automatisk. One row per flight: which of
// its renders is drawing — Kartverket's WMS or our own cache — is the style
// pulldown's business, not this one's. Under auto the list marks the resolved
// row but leaves Automatisk the active one: two accented rows would not say
// which a click undoes.
export const LidarDatasetPicker = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();
  // Blank inside a lokalitet whose Views have taken W/S: the heading must not
  // promise a ring it no longer has.
  const hint = useGroundRingHint();
  const [filterOpen, setFilterOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const { viewport, allProjects, autoDataset } = lidar;

  const datasetLabel =
    lidar.isLidarFlight && lidar.activeLidarProject
      ? lidar.activeLidarProject.projectName
      : t('ribbon.lidar.nationalMosaic');

  // The chip is one line wide, so that the pixels are ours only fits in the
  // tooltip.
  const datasetTitle = lidar.isLidarCvat
    ? `${datasetLabel} · ${t('ribbon.lidar.cvat')}`
    : datasetLabel;

  // Whether a row is the flight drawing, under either of its renders.
  const showingFlight = (id: string) =>
    lidar.isLidarFlight && lidar.activeLidarProject?.id === id;

  // The glyph for "Automatisk landed here", each row deciding for itself
  // whether it is the one showing.
  const autoMark = (showing: boolean | undefined) =>
    autoDataset && showing ? AUTO_ICON : undefined;

  const renderRow = (entry: LidarViewportEntry) => (
    <PulldownItem
      key={entry.project.id}
      label={entry.project.projectName}
      meta={projectMeta(entry)}
      active={!autoDataset && showingFlight(entry.project.id)}
      mark={autoMark(showingFlight(entry.project.id))}
      markLabel={t('ribbon.lidar.autoMark')}
      onActivate={() => lidar.activateProject(entry.project)}
      onHover={(hovering) =>
        lidar.setHoveredProjectId(hovering ? entry.project.id : null)
      }
    />
  );

  return (
    <Popover
      open={lidar.pickerOpen}
      onOpenChange={lidar.setPickerOpen}
      width={320}
      padded={false}
      label={t('ribbon.lidar.datasetLabel')}
      className={styles.trigger}
      trigger={
        <>
          <Button
            variant="secondary"
            size="md"
            className={styles.triggerButton}
            // The chip names the dataset on screen; whether auto put it there
            // is the secondary fact, so it is the icon.
            leftIcon={autoDataset ? AUTO_ICON : undefined}
            title={
              autoDataset
                ? t('ribbon.lidar.autoChipTip', { dataset: datasetTitle })
                : lidar.isLidarCvat
                  ? `${datasetTitle} — ${t('ribbon.lidar.cvatHint')}`
                  : datasetTitle
            }
            rightIcon={lidar.cyclingPending ? undefined : 'arrow_drop_down'}
            onClick={() => lidar.setPickerOpen(!lidar.pickerOpen)}
            aria-expanded={lidar.pickerOpen}
          >
            <span className={styles.triggerLabel}>{datasetLabel}</span>
            {/* The first W/S press after a pause only starts the footprint
                fetch; without this the key looks dead. */}
            {lidar.cyclingPending && <Spinner size={14} />}
          </Button>
          {/* How many datasets cover the viewport. */}
          <CountBadge
            count={lidar.datasetCount}
            palette="yellow"
            className={styles.triggerBadge}
          />
        </>
      }
    >
      <div className={styles.head}>
        <span>
          {t('ribbon.lidar.datasetHead')}
          {hint}
        </span>
        <IconButton
          icon="tune"
          size="xs"
          aria-label={t('ribbon.lidar.filter')}
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen(!filterOpen)}
        />
      </div>

      {filterOpen && <LidarFilters />}

      {/* Its meta line names the dataset auto has settled on. */}
      <PulldownItem
        label={t('ribbon.lidar.auto')}
        meta={autoDataset ? datasetLabel : t('ribbon.lidar.autoMeta')}
        active={autoDataset}
        onActivate={lidar.activateAuto}
      />
      <PulldownItem
        label={t('ribbon.lidar.nationalMosaic')}
        meta={t('ribbon.lidar.nationalMeta')}
        active={!autoDataset && lidar.isNationalMosaic}
        mark={autoMark(lidar.isNationalMosaic)}
        markLabel={t('ribbon.lidar.autoMark')}
        onActivate={lidar.activateNational}
      />
      <div className={styles.rule} />
      <p className={styles.hint}>{t('ribbon.lidar.projectsHint')}</p>

      <div
        className={styles.list}
        onMouseLeave={() => lidar.setHoveredProjectId(null)}
      >
        {/* 'idle' is the tick between the pulldown opening and the fetch
            effect starting. */}
        {(allProjects === null ||
          viewport.status === 'loading' ||
          viewport.status === 'idle') && (
          <div className={styles.busy}>
            <Spinner size={14} />
            {allProjects === null
              ? t('ribbon.lidar.loadingCatalogue')
              : t('ribbon.lidar.loadingFootprints')}
          </div>
        )}

        {/* The boundary WFS times out on a whole-country viewport rather than
            replying, so say so instead of spinning into an empty list. */}
        {viewport.status === 'zoomedOut' && (
          <p className={styles.hint}>{t('ribbon.lidar.zoomedOut')}</p>
        )}
        {viewport.status === 'error' && (
          <p className={styles.hint}>{t('ribbon.lidar.error')}</p>
        )}
        {allProjects != null &&
          viewport.status === 'ready' &&
          viewport.primary.length === 0 &&
          viewport.secondary.length === 0 && (
            <p className={styles.hint}>{t('ribbon.lidar.empty')}</p>
          )}

        {viewport.status === 'ready' && viewport.primary.map(renderRow)}
        {viewport.status === 'ready' && viewport.secondary.length > 0 && (
          <>
            <PulldownDisclosure
              open={moreOpen}
              label={t('ribbon.lidar.lessRelevant', {
                count: viewport.secondary.length,
              })}
              onToggle={() => setMoreOpen(!moreOpen)}
            />
            {moreOpen && viewport.secondary.map(renderRow)}
          </>
        )}
      </div>
    </Popover>
  );
};
