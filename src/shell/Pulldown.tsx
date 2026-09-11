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
 *
 * `hint` is for a row whose explanation is a sentence. `meta` cannot carry one
 * — it is `nowrap` beside the label, and rightly so, since a list of wrapping
 * paragraphs stops being scannable — so the sentence goes in the tooltip
 * instead, which is also where it belongs: the explanation you want is of the
 * option you are *considering*, not the one already selected.
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
 * A row that toggles rather than selects. Same geometry as PulldownItem, but
 * a checkbox glyph instead of the active row's left bar: in a list where
 * several rows can be on at once, that bar reads as "this is the one" and
 * says the wrong thing about the other three.
 *
 * `indent` is for a source's own sublayers — one level only, since the
 * register's hierarchy below that is not something this app asks about.
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
