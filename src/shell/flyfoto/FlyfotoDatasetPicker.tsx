import { useTranslation } from 'react-i18next';
import type { FlyfotoProject } from '../../localities/flyfotoProjects';
import { Button, CountBadge, Popover, Spinner } from '../../ui';
import { PulldownItem } from '../Pulldown';
import styles from '../Pulldown.module.css';
import { useGroundRingHint } from '../visningRing';
import type { FlyfotoControls } from './useFlyfotoControls';

// The exact date where the archive has one: the project name carries only the
// year, so two flights over the same town in one year look identical without it.
const projectMeta = (p: FlyfotoProject): string =>
  [
    p.photoDate ?? (p.year != null ? String(p.year) : null),
    p.metresPerPx != null ? `${p.metresPerPx} m/px` : null,
  ]
    .filter((s): s is string => !!s)
    .join(' · ');

// Norge i bilder's seamless mosaic, or one acquisition, newest first. No
// hover-to-preview footprint as LiDAR has: the index query returns no geometry.
export const FlyfotoDatasetPicker = ({
  flyfoto,
}: {
  flyfoto: FlyfotoControls;
}) => {
  const { t } = useTranslation();
  // Blank inside a lokalitet whose Views have taken W/S: the heading must not
  // promise a ring it no longer has.
  const hint = useGroundRingHint();
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
          {/* Acquisitions covering the viewport and inside the chosen period,
              which is the list a click or a W/S press walks. */}
          <CountBadge
            count={flyfoto.projects.length}
            palette="yellow"
            className={styles.triggerBadge}
          />
        </>
      }
    >
      <div className={styles.head}>
        <span>
          {t('ribbon.flyfoto.datasetHead')}
          {hint}
        </span>
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
        {/* Above the rows, not instead of them: the previous view's stay up
            while the next one loads. */}
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
            {/* Never flown here, or not in the chosen period — the second is
                one click from being undone, so say which. */}
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
