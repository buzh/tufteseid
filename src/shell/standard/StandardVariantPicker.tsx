import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { STANDARD_VARIANTS } from '../../map/layers/config/backgroundLayers/standardVariants';
import { cx, Icon, Popover, Tooltip } from '../../ui';
import { PulldownItem } from '../Pulldown';
import pulldown from '../Pulldown.module.css';
import styles from './StandardVariantPicker.module.css';
import type { StandardControls } from './useStandardControls';

/**
 * Which map Kart draws: three renderings of the current topographic map, the
 * nautical chart, or the nineteenth-century amtskart series.
 *
 * **It hangs off the `Kart` button itself**, as a caret welded to that
 * button's right edge, and is the reason Standard is the one ground with no
 * settings strip. The strip was a whole row carrying one pulldown and a label
 * repeating the lit button above it — the other four grounds put two to six
 * controls on that row and earn it; this one did not. The rest of §5.1's
 * contract is untouched: LiDAR, Hybrid, Flyfoto and Terreng keep their strip,
 * so the caret here means "this button has a list", not a new idiom the other
 * three buttons are missing.
 *
 * What the move costs, stated rather than hidden: the active cartography is
 * no longer written anywhere on the bar. It is in the caret's tooltip, in the
 * list's active row, and — the reason that is enough — on the map, since the
 * five are visually nothing alike in the way two LiDAR acquisitions are.
 *
 * Openable from any ground, which is the thing the strip could not do: it only
 * ever existed while Standard was already up, so "give me the nautical chart"
 * from LiDAR was two presses. Picking a row therefore has to *enter* the
 * ground rather than just set the background — `onPickGround` is
 * `ground.select('standard')` — or a pick made from Hybrid would leave the
 * hybrid overlay switched on over a topo base, and one made from Terreng would
 * change the ground under a render nobody can see through.
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
  onPickGround,
}: {
  standard: StandardControls;
  /** Make Standard the ground on screen. Run before the variant is applied. */
  onPickGround: () => void;
}) => {
  const { t } = useTranslation();

  const tip = t('ribbon.standard.triggerTip', {
    name: t(`ribbon.standard.${standard.active}`),
  });

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
        <span>{t('ribbon.standard.datasetHead')}</span>
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
