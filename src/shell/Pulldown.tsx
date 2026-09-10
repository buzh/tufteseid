import { cx, Icon } from '../ui';
import styles from './Pulldown.module.css';

/**
 * One selectable row. `onHover` fires for pointer *and* focus, so tabbing
 * the list lights up the same footprint on the map that mousing it would.
 */
export const PulldownItem = ({
  label,
  meta,
  active,
  onActivate,
  onHover,
}: {
  label: string;
  meta?: string;
  active: boolean;
  onActivate: () => void;
  onHover?: (hovering: boolean) => void;
}) => (
  <button
    type="button"
    title={label}
    aria-current={active}
    className={cx(styles.item, active && styles.itemActive)}
    onClick={onActivate}
    onMouseEnter={() => onHover?.(true)}
    onMouseLeave={() => onHover?.(false)}
    onFocus={() => onHover?.(true)}
    onBlur={() => onHover?.(false)}
  >
    <span className={styles.itemLabel}>{label}</span>
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
