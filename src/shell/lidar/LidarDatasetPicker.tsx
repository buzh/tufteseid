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

// The glyph on whichever row "Automatisk" has landed on. Also the chip's
// left icon, so the same symbol means the same thing whether the pulldown
// is open or shut.
const AUTO_ICON = 'bolt';

/**
 * Which LiDAR dataset is painting the map: the seamless national mosaic, one
 * specific acquisition, or **Automatisk** — the mosaic when zoomed out, the
 * best-covering acquisition once close enough in for its finer grid to show
 * (see lidarAuto.ts). Coverage is confirmed against real WFS footprint
 * polygons rather than bounding boxes — see lidarFootprintsLayer.ts.
 *
 * Under auto the list marks the resolved row but does not make it *active*:
 * the active row is "Automatisk", because that is the choice the user made.
 * Two accented rows would leave it ambiguous which one a click would undo.
 */
export const LidarDatasetPicker = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();
  const [filterOpen, setFilterOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const { viewport, allProjects, autoDataset } = lidar;

  const datasetLabel =
    lidar.isLidarProject && lidar.activeLidarProject
      ? lidar.activeLidarProject.projectName
      : t('ribbon.lidar.nationalMosaic');

  const isAutoRow = (projectId: string | null) =>
    autoDataset &&
    (projectId == null
      ? lidar.isNationalMosaic
      : lidar.isLidarProject && lidar.activeLidarProject?.id === projectId);

  const renderRow = (entry: LidarViewportEntry) => (
    <PulldownItem
      key={entry.project.id}
      label={entry.project.projectName}
      meta={projectMeta(entry)}
      active={
        !autoDataset &&
        lidar.isLidarProject &&
        lidar.activeLidarProject?.id === entry.project.id
      }
      mark={isAutoRow(entry.project.id) ? AUTO_ICON : undefined}
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
            // The chip keeps naming the dataset actually on screen — that's
            // the fact the user needs while reading terrain. Whether it got
            // there by itself is the secondary fact, so it's the icon.
            leftIcon={autoDataset ? AUTO_ICON : undefined}
            title={
              autoDataset
                ? t('ribbon.lidar.autoChipTip', { dataset: datasetLabel })
                : datasetLabel
            }
            rightIcon={lidar.cyclingPending ? undefined : 'arrow_drop_down'}
            onClick={() => lidar.setPickerOpen(!lidar.pickerOpen)}
            aria-expanded={lidar.pickerOpen}
          >
            <span className={styles.triggerLabel}>{datasetLabel}</span>
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

      {/* First, because it is the answer for most views and because the two
          rows under it are what it chooses between. Its meta line names the
          dataset it has currently settled on, so the row explains itself
          without the user having to look at the chip. */}
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
        mark={isAutoRow(null) ? AUTO_ICON : undefined}
        markLabel={t('ribbon.lidar.autoMark')}
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
