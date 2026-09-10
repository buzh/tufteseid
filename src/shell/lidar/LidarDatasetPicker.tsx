import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LidarViewportEntry } from '../../map/layers/config/backgroundLayers/lidarRelevance';
import { Button, CountBadge, IconButton, Popover, Spinner } from '../../ui';
import { PulldownDisclosure, PulldownItem } from '../Pulldown';
import styles from '../Pulldown.module.css';
import { LidarFilters } from './LidarFilters';
import type { LidarControls } from './useLidarControls';

// Worth a column of its own because it's what the list is ordered by: how
// much of the current screen this project's footprint paints.
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

/**
 * Which LiDAR dataset is painting the map: the seamless national mosaic, or
 * one specific acquisition. Coverage is confirmed against real WFS footprint
 * polygons rather than bounding boxes — see lidarFootprintsLayer.ts.
 */
export const LidarDatasetPicker = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();
  const [filterOpen, setFilterOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const { viewport, allProjects } = lidar;

  const chipLabel =
    lidar.isLidarProject && lidar.activeLidarProject
      ? lidar.activeLidarProject.projectName
      : t('ribbon.lidar.nationalMosaic');

  const renderRow = (entry: LidarViewportEntry) => (
    <PulldownItem
      key={entry.project.id}
      label={entry.project.projectName}
      meta={projectMeta(entry)}
      active={
        lidar.isLidarProject &&
        lidar.activeLidarProject?.id === entry.project.id
      }
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
            rightIcon={lidar.cyclingPending ? undefined : 'arrow_drop_down'}
            onClick={() => lidar.setPickerOpen(!lidar.pickerOpen)}
            aria-expanded={lidar.pickerOpen}
          >
            <span className={styles.triggerLabel}>{chipLabel}</span>
            {/* First W/S press after a pause only kicks off the footprint
                fetch; without this the key looks dead. */}
            {lidar.cyclingPending && <Spinner size={14} />}
          </Button>
          {/* How many datasets cover the viewport — i.e. how much this
              pulldown has to offer here. */}
          <CountBadge
            count={lidar.datasetCount}
            palette="yellow"
            className={styles.triggerBadge}
          />
        </>
      }
    >
      <div className={styles.head}>
        <span>{t('ribbon.lidar.datasetHead')}</span>
        <IconButton
          icon="tune"
          size="xs"
          aria-label={t('ribbon.lidar.filter')}
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen(!filterOpen)}
        />
      </div>

      {filterOpen && <LidarFilters />}

      <PulldownItem
        label={t('ribbon.lidar.nationalMosaic')}
        meta={t('ribbon.lidar.nationalMeta')}
        active={lidar.isNationalMosaic}
        onActivate={lidar.activateNational}
      />
      <div className={styles.rule} />
      <p className={styles.hint}>{t('ribbon.lidar.projectsHint')}</p>

      <div
        className={styles.list}
        onMouseLeave={() => lidar.setHoveredProjectId(null)}
      >
        {/* 'idle' is reachable here for the tick between the pulldown
            opening and the fetch effect starting. */}
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

        {/* Coverage can't be answered for a whole-country viewport — the
            boundary WFS times out rather than replying, so say so instead of
            spinning into an empty list. */}
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
