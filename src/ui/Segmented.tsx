import type { ButtonPalette } from './Button';
import { cx } from './cx';
import { Icon, type MaterialSymbol } from './Icon';
import styles from './Segmented.module.css';

const PALETTE_CLASS: Record<ButtonPalette, string> = {
  green: styles.paletteGreen,
  gray: styles.paletteGray,
  red: styles.paletteRed,
  blue: styles.paletteBlue,
};

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: MaterialSymbol;
  palette?: ButtonPalette;
  disabled?: boolean;
  /**
   * Native tooltip on this option alone. For sets where the label names a
   * thing the reader may not know yet — the five terrain visualizations — and
   * the hint therefore belongs to the option being *considered*, not to the
   * group or to the one already selected.
   */
  title?: string;
};

/*
 * One click per value. Beats a <select> for the small closed sets in this
 * app (synlighet, funn status, DTM/DOM, terrain visualization) because the
 * options stay readable without opening anything — which matters when the
 * thing behind the control is the terrain you are reading.
 *
 * Rendered as a radiogroup rather than a row of toggle buttons so arrow keys
 * move between options the way a keyboard user expects.
 */
export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  disabled,
  size = 'xs',
  label,
  className,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: 'xs' | 'sm';
  label?: string;
  className?: string;
}) => {
  const move = (delta: number) => {
    const usable = options.filter((o) => !o.disabled);
    if (usable.length === 0) return;
    const at = usable.findIndex((o) => o.value === value);
    const next = usable[(at + delta + usable.length) % usable.length];
    if (next) onChange(next.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(styles.root, className)}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tabindex: one stop for the whole group.
            tabIndex={selected ? 0 : -1}
            disabled={disabled || o.disabled}
            title={o.title}
            className={cx(
              styles.option,
              styles[size],
              selected && styles.selected,
              PALETTE_CLASS[o.palette ?? 'green'],
            )}
            onClick={() => onChange(o.value)}
          >
            {o.icon && <Icon icon={o.icon} size={size === 'xs' ? 14 : 16} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
};
