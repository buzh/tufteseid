import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { STANDARD_VARIANTS } from '../../map/layers/config/backgroundLayers/standardVariants';
import { Button, Popover } from '../../ui';
import { PulldownItem } from '../Pulldown';
import styles from '../Pulldown.module.css';
import type { StandardControls } from './useStandardControls';

/**
 * Which map Standard draws: three renderings of the current topographic map,
 * the nautical chart, or the nineteenth-century amtskart series.
 *
 * No count badge, no spinner and no "less relevant" tier, unlike the LiDAR
 * and ortofoto pulldowns: the list is five national products that are the
 * same wherever you are looking, so there is nothing to query and nothing to
 * rank. Five rows is also short enough that the whole thing is legible at a
 * glance, which is why the historical map is a row in the same list rather
 * than a mode of its own — the point is that it is *a map of this place*,
 * next to the others.
 *
 * The rule above amtskart is derived from its position in STANDARD_VARIANTS
 * rather than from a second list, so the pulldown and the W/S ring cannot
 * disagree about the order.
 */
export const StandardVariantPicker = ({
  standard,
}: {
  standard: StandardControls;
}) => {
  const { t } = useTranslation();

  return (
    <Popover
      open={standard.pickerOpen}
      onOpenChange={standard.setPickerOpen}
      width={300}
      padded={false}
      label={t('ribbon.standard.datasetLabel')}
      className={styles.trigger}
      trigger={
        <Button
          variant="secondary"
          size="md"
          className={styles.triggerButton}
          rightIcon="arrow_drop_down"
          onClick={() => standard.setPickerOpen(!standard.pickerOpen)}
          aria-expanded={standard.pickerOpen}
        >
          <span className={styles.triggerLabel}>
            {t(`ribbon.standard.${standard.active}`)}
          </span>
        </Button>
      }
    >
      <div className={styles.head}>
        <span>{t('ribbon.standard.datasetHead')}</span>
      </div>

      {STANDARD_VARIANTS.map((variant) => (
        <Fragment key={variant}>
          {variant === 'amtskart' && (
            <>
              <div className={styles.rule} />
              <p className={styles.hint}>{t('ribbon.standard.historicHint')}</p>
            </>
          )}
          <PulldownItem
            label={t(`ribbon.standard.${variant}`)}
            meta={t(`ribbon.standard.${variant}Meta`)}
            active={standard.active === variant}
            onActivate={() => standard.activate(variant)}
          />
        </Fragment>
      ))}
    </Popover>
  );
};
