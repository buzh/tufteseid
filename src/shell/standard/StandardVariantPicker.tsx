import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { STANDARD_VARIANTS } from '../../map/layers/config/backgroundLayers/standardVariants';
import { cx, Icon, Popover, Tooltip } from '../../ui';
import { PulldownItem } from '../Pulldown';
import pulldown from '../Pulldown.module.css';
import { useGroundRingHint } from '../visningRing';
import styles from './StandardVariantPicker.module.css';
import type { StandardControls } from './useStandardControls';

/**
 * Openable from any ground, which is why picking a row has to *enter* Standard
 * and not just set the background: a pick made from Hybrid would otherwise
 * leave the overlay on over a topo base. The rule above amtskart comes from its
 * position in STANDARD_VARIANTS, so the list and the W/S ring cannot disagree.
 */
export const StandardVariantPicker = ({
  standard,
  onPickGround,
}: {
  standard: StandardControls;
  /** Make Standard the ground on screen. Run before the variant is applied. */
  onPickGround: () => void;
}) => {
  const { t } = useTranslation();
  const hint = useGroundRingHint();

  // Two strings rather than a composed one: the tooltip ends in the shortcut
  // in parentheses, so dropping the shortcut takes the parentheses with it.
  const tip = t(
    hint ? 'ribbon.standard.triggerTip' : 'ribbon.standard.triggerTipPlain',
    { name: t(`ribbon.standard.${standard.active}`) },
  );

  return (
    <Popover
      open={standard.pickerOpen}
      onOpenChange={standard.setPickerOpen}
      width={300}
      padded={false}
      label={t('ribbon.standard.datasetLabel')}
      trigger={
        <Tooltip label={tip}>
          <button
            type="button"
            className={cx(
              styles.caret,
              standard.pickerOpen && styles.caretOpen,
            )}
            aria-label={tip}
            aria-expanded={standard.pickerOpen}
            onClick={() => standard.setPickerOpen(!standard.pickerOpen)}
          >
            <Icon icon="arrow_drop_down" size={18} />
          </button>
        </Tooltip>
      }
    >
      <div className={pulldown.head}>
        <span>
          {t('ribbon.standard.datasetHead')}
          {hint}
        </span>
      </div>

      {STANDARD_VARIANTS.map((variant) => (
        <Fragment key={variant}>
          {variant === 'amtskart' && (
            <>
              <div className={pulldown.rule} />
              <p className={pulldown.hint}>
                {t('ribbon.standard.historicHint')}
              </p>
            </>
          )}
          <PulldownItem
            label={t(`ribbon.standard.${variant}`)}
            meta={t(`ribbon.standard.${variant}Meta`)}
            active={standard.active === variant}
            onActivate={() => {
              onPickGround();
              standard.activate(variant);
            }}
          />
        </Fragment>
      ))}
    </Popover>
  );
};
