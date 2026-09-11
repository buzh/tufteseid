import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Popover } from '../../ui';
import { PulldownItem } from '../Pulldown';
import styles from '../Pulldown.module.css';
import { VISUALIZATIONS, type TerrainAnalysis } from './useTerrainAnalysis';

/**
 * Which relief Terreng draws from the elevation grid it has fetched.
 *
 * A pulldown and a W/S ring rather than eight buttons, which is the same call
 * §5.2 made for Standard's five cartographies and for the same reason: these
 * are one question about this ground — *what does the shape of it look like* —
 * answered eight ways, not eight things to flip between. It replaced a
 * segmented control, which was right at five options and unrenderable at
 * eight; the settings strip is the tightest row in the app and Terreng brings
 * the most controls to it.
 *
 * No count badge, no spinner and no relevance tier, like Standard's and unlike
 * LiDAR's and the ortofoto one: the list is the same eight everywhere, known
 * at build time, and nothing about where you are looking changes it.
 *
 * The two rules are derived from position in VISUALIZATIONS rather than from a
 * second list, so the pulldown and the ring cannot disagree about the order —
 * and that order is load-bearing here in a way it is not for cartographies,
 * because walking from VAT down through the horizon views is free while the
 * same steps in another order are not (see VISUALIZATIONS).
 *
 * Each row carries its explanation as a tooltip rather than as body text: a
 * sentence per row over eight rows is a wall, and the explanation you want is
 * of the option you are considering, not the one you already picked.
 */
export const TerrainVisPicker = ({ terrain }: { terrain: TerrainAnalysis }) => {
  const { t } = useTranslation();

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
        <span>{t('localities.terrain.visHead')}</span>
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
