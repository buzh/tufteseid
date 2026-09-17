import { cx, Icon, type MaterialSymbol } from '../ui';
import styles from './Pulldown.module.css';

/**
 * One selectable row. `onHover` fires for pointer and focus, so tabbing the
 * list lights the same footprint on the map that mousing it would.
 *
 * `mark` is weaker than `active`: "this row is implicated" without claiming it
 * was chosen — the LiDAR picker points with it at the acquisition *Automatisk*
 * landed on. The glyph is aria-hidden, so `markLabel` folds into the tooltip.
 *
 * `hint` is a sentence, and goes in the tooltip because `meta` is `nowrap`
 * beside the label.
 */
export const PulldownItem = ({
  label,
  meta,
  hint,
  active,
  mark,
  markLabel,
  onActivate,
  onHover,
}: {
  label: string;
  meta?: string;
  hint?: string;
  active: boolean;
  mark?: MaterialSymbol;
  markLabel?: string;
  onActivate: () => void;
  onHover?: (hovering: boolean) => void;
}) => (
  <button
    type="button"
    title={
      hint
        ? `${label} — ${hint}`
        : mark && markLabel
          ? `${label} — ${markLabel}`
          : label
    }
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

/**
 * A row that toggles rather than selects: a checkbox glyph instead of the
 * active row's left bar, since several can be on at once. `indent` is for a
 * source's own sublayers, one level only.
 */
export const PulldownCheck = ({
  label,
  checked,
  indent,
  onToggle,
}: {
  label: string;
  checked: boolean;
  indent?: boolean;
  onToggle: () => void;
}) => (
  <button
    type="button"
    role="menuitemcheckbox"
    aria-checked={checked}
    className={cx(styles.item, indent && styles.itemIndent)}
    onClick={onToggle}
  >
    <Icon
      icon={checked ? 'check_box' : 'check_box_outline_blank'}
      size={18}
      className={checked ? styles.checkOn : styles.checkOff}
    />
    <span className={styles.itemLabel}>{label}</span>
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
