import { cx, Icon, type MaterialSymbol } from '../ui';
import styles from './Pulldown.module.css';

/**
 * One selectable row. `onHover` fires for pointer *and* focus, so tabbing
 * the list lights up the same footprint on the map that mousing it would.
 *
 * `mark` is a second, weaker kind of highlight than `active`: it says "this
 * row is implicated" without claiming it is the thing you selected. The
 * LiDAR dataset picker uses it to point at the acquisition **Automatisk**
 * has landed on, which is showing on the map but is not what the user
 * chose — the row they chose is *Automatisk*, further up.
 *
 * The mark glyph is aria-hidden like every Icon, so `markLabel` folds into
 * the row's tooltip: that is the only place its meaning can live.
 */
export const PulldownItem = ({
  label,
  meta,
  active,
  mark,
  markLabel,
  onActivate,
  onHover,
}: {
  label: string;
  meta?: string;
  active: boolean;
  mark?: MaterialSymbol;
  markLabel?: string;
  onActivate: () => void;
  onHover?: (hovering: boolean) => void;
}) => (
  <button
    type="button"
    title={mark && markLabel ? `${label} — ${markLabel}` : label}
    aria-current={active}
    className={cx(styles.item, active && styles.itemActive)}
    onClick={onActivate}
    onMouseEnter={() => onHover?.(true)}
    onMouseLeave={() => onHover?.(false)}
    onFocus={() => onHover?.(true)}
    onBlur={() => onHover?.(false)}
  >
    <span className={styles.itemLabel}>{label}</span>
    {mark && <Icon icon={mark} size={14} className={styles.itemMark} />}
    {meta && <span className={styles.itemMeta}>{meta}</span>}
  </button>
);

/** Opens/closes an overflow group. */
export const PulldownDisclosure = ({
  open,
  label,
  onToggle,
}: {
  open: boolean;
  label: string;
  onToggle: () => void;
}) => (
  <button
    type="button"
    className={styles.disclosure}
    aria-expanded={open}
    onClick={onToggle}
  >
    <Icon
      icon="chevron_forward"
      size={16}
      className={cx(styles.chevron, open && styles.chevronOpen)}
    />
    {label}
  </button>
);
