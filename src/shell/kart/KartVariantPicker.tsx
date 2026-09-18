import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { KART_VARIANTS } from '../../map/layers/config/backgroundLayers/kartVariants';
import { cx, Icon, Popover, Tooltip } from '../../ui';
import { PulldownItem } from '../Pulldown';
import pulldown from '../Pulldown.module.css';
import { useGroundRingHint } from '../visningRing';
import styles from './KartVariantPicker.module.css';
import type { KartControls } from './useKartControls';

/**
 * Openable from any ground, which is why picking a row has to *enter* Kart
 * and not just set the background: a pick made from Hybrid would otherwise
 * leave the overlay on over a topo base. The rule above amtskart comes from its
 * position in KART_VARIANTS, so the list and the W/S ring cannot disagree.
 */
export const KartVariantPicker = ({
  kart,
  onPickGround,
}: {
  kart: KartControls;
  /** Make Kart the ground on screen. Run before the variant is applied. */
  onPickGround: () => void;
}) => {
  const { t } = useTranslation();
  const hint = useGroundRingHint();

  // Two strings rather than a composed one: the tooltip ends in the shortcut
  // in parentheses, so dropping the shortcut takes the parentheses with it.
  const tip = t(
    hint ? 'ribbon.kart.triggerTip' : 'ribbon.kart.triggerTipPlain',
    { name: t(`ribbon.kart.${kart.active}`) },
  );

  return (
    <Popover
      open={kart.pickerOpen}
      onOpenChange={kart.setPickerOpen}
      width={300}
      padded={false}
      label={t('ribbon.kart.datasetLabel')}
      trigger={
        <Tooltip label={tip}>
          <button
            type="button"
            className={cx(
              styles.caret,
              kart.pickerOpen && styles.caretOpen,
            )}
            aria-label={tip}
            aria-expanded={kart.pickerOpen}
            onClick={() => kart.setPickerOpen(!kart.pickerOpen)}
          >
            <Icon icon="arrow_drop_down" size={18} />
          </button>
        </Tooltip>
      }
    >
      <div className={pulldown.head}>
        <span>
          {t('ribbon.kart.datasetHead')}
          {hint}
        </span>
      </div>

      {KART_VARIANTS.map((variant) => (
        <Fragment key={variant}>
          {variant === 'amtskart' && (
            <>
              <div className={pulldown.rule} />
              <p className={pulldown.hint}>
                {t('ribbon.kart.historicHint')}
              </p>
            </>
          )}
          <PulldownItem
            label={t(`ribbon.kart.${variant}`)}
            meta={t(`ribbon.kart.${variant}Meta`)}
            active={kart.active === variant}
            onActivate={() => {
              onPickGround();
              kart.activate(variant);
            }}
          />
        </Fragment>
      ))}
    </Popover>
  );
};
