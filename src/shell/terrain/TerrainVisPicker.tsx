import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Popover } from '../../ui';
import { PulldownItem } from '../Pulldown';
import styles from '../Pulldown.module.css';
import { useGroundRingHint } from '../visningRing';
import { VISUALIZATIONS, type TerrainAnalysis } from './useTerrainAnalysis';

export const TerrainVisPicker = ({ terrain }: { terrain: TerrainAnalysis }) => {
  const { t } = useTranslation();
  // Blank inside a lokalitet whose Views have taken W/S: the heading must not
  // promise a ring it no longer has.
  const hint = useGroundRingHint();

  return (
    <Popover
      open={terrain.pickerOpen}
      onOpenChange={terrain.setPickerOpen}
      width={320}
      padded={false}
      label={t('localities.terrain.visualization')}
      className={styles.trigger}
      trigger={
        <Button
          variant="secondary"
          size="md"
          className={styles.triggerButton}
          rightIcon="arrow_drop_down"
          onClick={() => terrain.setPickerOpen(!terrain.pickerOpen)}
          aria-expanded={terrain.pickerOpen}
        >
          <span className={styles.triggerLabel}>
            {t(`localities.terrain.vis.${terrain.vis}`)}
          </span>
        </Button>
      }
    >
      <div className={styles.head}>
        <span>
          {t('localities.terrain.visHead')}
          {hint}
        </span>
      </div>

      {VISUALIZATIONS.map((vis) => (
        <Fragment key={vis}>
          {/* The composite, then the views that need no sun at all. */}
          {(vis === 'vat' || vis === 'svf') && (
            <>
              <div className={styles.rule} />
              <p className={styles.hint}>
                {t(`localities.terrain.visGroup.${vis}`)}
              </p>
            </>
          )}
          <PulldownItem
            label={t(`localities.terrain.vis.${vis}`)}
            meta={t(`localities.terrain.visMeta.${vis}`)}
            hint={t(`localities.terrain.visHint.${vis}`)}
            active={terrain.vis === vis}
            onActivate={() => terrain.activate(vis)}
          />
        </Fragment>
      ))}
    </Popover>
  );
};
