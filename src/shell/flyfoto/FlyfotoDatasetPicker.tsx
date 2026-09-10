import { useTranslation } from 'react-i18next';
import type { FlyfotoProject } from '../../localities/flyfotoProjects';
import { Button, CountBadge, Popover, Spinner } from '../../ui';
import { PulldownItem } from '../Pulldown';
import styles from '../Pulldown.module.css';
import type { FlyfotoControls } from './useFlyfotoControls';

// The exact date where the archive has one — the project name usually
// carries only the year, and two flights over the same town in the same
// year are otherwise indistinguishable in the list.
const projectMeta = (p: FlyfotoProject): string =>
  [
    p.photoDate ?? (p.year != null ? String(p.year) : null),
    p.metresPerPx != null ? `${p.metresPerPx} m/px` : null,
  ]
    .filter((s): s is string => !!s)
    .join(' · ');

/**
 * Which ortofoto is painting the map: Norge i bilder's seamless
 * best-available mosaic, or one specific acquisition out of the archive.
 * Listed newest first, so walking down the list walks back in time.
 *
 * No filter sub-panel and no hover-to-preview footprint, unlike the LiDAR
 * pulldown next to it: the index query returns no geometry, so there is
 * nothing to draw and no coverage ratio to rank by, and the list is already
 * scoped to acquisitions whose real outline touches this screen. The one
 * filter it has — the period — is on the strip beside this chip rather than
 * inside it (FlyfotoEraPicker), because with a hundred rows in a city the
 * period is the first thing you set and the last thing you should have to
 * open a pulldown to see.
 */
export const FlyfotoDatasetPicker = ({
  flyfoto,
}: {
  flyfoto: FlyfotoControls;
}) => {
  const { t } = useTranslation();
  const { viewport } = flyfoto;

  const chipLabel =
    flyfoto.isProject && flyfoto.activeProject
      ? flyfoto.activeProject.projectName
      : t('ribbon.flyfoto.mosaic');

  return (
    <Popover
      open={flyfoto.pickerOpen}
      onOpenChange={flyfoto.setPickerOpen}
      width={320}
      padded={false}
      label={t('ribbon.flyfoto.datasetLabel')}
      className={styles.trigger}
      trigger={
        <>
          <Button
            variant="secondary"
            size="md"
            className={styles.triggerButton}
            rightIcon="arrow_drop_down"
            onClick={() => flyfoto.setPickerOpen(!flyfoto.pickerOpen)}
            aria-expanded={flyfoto.pickerOpen}
          >
            <span className={styles.triggerLabel}>{chipLabel}</span>
          </Button>
          {/* How many acquisitions this pulldown has to offer here: covering
              the viewport *and* inside the chosen period, because that is
              the list a click or a W/S press will actually walk. */}
          <CountBadge
            count={flyfoto.projects.length}
            palette="yellow"
            className={styles.triggerBadge}
          />
        </>
      }
    >
      <div className={styles.head}>
        <span>{t('ribbon.flyfoto.datasetHead')}</span>
      </div>

      <PulldownItem
        label={t('ribbon.flyfoto.mosaic')}
        meta={t('ribbon.flyfoto.mosaicMeta')}
        active={flyfoto.isMosaic}
        onActivate={flyfoto.activateMosaic}
      />
      <div className={styles.rule} />
      <p className={styles.hint}>{t('ribbon.flyfoto.projectsHint')}</p>

      <div className={styles.list}>
        {/* Rows from the previous view stay up while the next one loads, so
            this sits above them rather than replacing them. */}
        {(viewport.status === 'loading' || viewport.status === 'idle') && (
          <div className={styles.busy}>
            <Spinner size={14} />
            {t('ribbon.flyfoto.loading')}
          </div>
        )}

        {viewport.status === 'zoomedOut' && (
          <p className={styles.hint}>{t('ribbon.flyfoto.zoomedOut')}</p>
        )}
        {viewport.status === 'error' && (
          <p className={styles.hint}>{t('ribbon.flyfoto.error')}</p>
        )}
        {viewport.status === 'ready' && flyfoto.projects.length === 0 && (
          <p className={styles.hint}>
            {/* Two different nothings: the archive has never flown here, or
                it has but not in the period the chips are set to. The second
                is one click from being undone, so say which one it is. */}
            {viewport.projects.length === 0
              ? t('ribbon.flyfoto.empty')
              : t('ribbon.flyfoto.emptyEra')}
          </p>
        )}

        {flyfoto.projects.map((p) => (
          <PulldownItem
            key={p.id}
            label={p.projectName}
            meta={projectMeta(p)}
            active={flyfoto.isProject && flyfoto.activeProject?.id === p.id}
            onActivate={() => flyfoto.activateProject(p)}
          />
        ))}
      </div>
    </Popover>
  );
};
