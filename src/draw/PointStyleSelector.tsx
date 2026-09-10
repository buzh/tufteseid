import { useAtom, useAtomValue } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pointIconAtom, primaryColorAtom } from '../settings/draw/atoms';
import { Button, cx, Icon, type MaterialSymbol, Popover } from '../ui';
import styles from './Draw.module.css';
import { isDrawIconFilled } from './drawControls/drawUtils';

const icons: MaterialSymbol[] = [
  'circle',
  'change_history',
  'square',
  'directions_walk',
  'directions_bike',
  'kayaking',
  'sledding',
  'phishing',
  'camping',
  'anchor',
  'home_pin',
  'pin_drop',
  'flag',
  'local_parking',
  'beenhere',
  'local_see',
  'elevation',
  'ac_unit',
];

/*
 * A grid of glyphs in a pulldown, not a `<select>`: the options *are* the
 * pictures, and a native option list can only carry their English slugs.
 * Each is drawn in the point colour, so the panel previews the marker rather
 * than naming it.
 */
export const PointStyleSelector = () => {
  const [pointIcon, setPointIcon] = useAtom(pointIconAtom);
  const color = useAtomValue(primaryColorAtom);
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  return (
    <div className={styles.group}>
      <span className={styles.groupLabel}>{t('draw.controls.pointType')}</span>
      <Popover
        open={open}
        onOpenChange={setOpen}
        width={240}
        label={t('draw.controls.pointType')}
        trigger={
          <Button
            variant="secondary"
            rightIcon="arrow_drop_down"
            aria-label={t('draw.controls.pointType')}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon
              icon={pointIcon}
              filled={isDrawIconFilled(pointIcon)}
              color={color}
              size={18}
            />
          </Button>
        }
      >
        <div className={styles.iconGrid}>
          {icons.map((icon) => (
            <button
              key={icon}
              type="button"
              aria-label={icon}
              aria-pressed={icon === pointIcon}
              className={cx(
                styles.iconChoice,
                icon === pointIcon && styles.iconChoiceActive,
              )}
              onClick={() => {
                setPointIcon(icon);
                setOpen(false);
              }}
            >
              <Icon
                icon={icon}
                filled={isDrawIconFilled(icon)}
                color={color}
                size={20}
              />
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
};
