import { CountBadge, cx, Icon, type MaterialSymbol, Tooltip } from '../ui';
import styles from './ModeButton.module.css';

export const ModeButton = ({
  icon,
  label,
  tooltip,
  ariaLabel,
  active,
  badge,
  disabled,
  joinedRight,
  onClick,
}: {
  icon: MaterialSymbol;
  label: string;
  tooltip?: string;
  /**
   * The accessible name, when the tooltip is a *verb* that changes with
   * `active`. Saying both the verb and the state announces "Hide the finds,
   * pressed", so a toggle whose tooltip flips passes its stable noun here and
   * lets `aria-pressed` carry the rest. `LayerGroup` is why this exists.
   */
  ariaLabel?: string;
  active?: boolean;
  badge?: number | string;
  disabled?: boolean;
  /** This button is the left half of a split control and something is butted
   *  against it — square that edge off and pull the badge in off it. The two
   *  are `LayerGroup` and `EyeSplit`. */
  joinedRight?: boolean;
  onClick: () => void;
}) => (
  <Tooltip label={tooltip ?? label}>
    <span className={cx(styles.wrap, joinedRight && styles.joinedRight)}>
      <button
        type="button"
        className={cx(styles.button, active && styles.active)}
        aria-pressed={active}
        aria-label={ariaLabel ?? tooltip ?? label}
        disabled={disabled}
        onClick={onClick}
      >
        <Icon icon={icon} size={21} filled={active} />
        <span className={styles.label}>{label}</span>
      </button>
      <CountBadge count={badge} palette="yellow" className={styles.badge} />
    </span>
  </Tooltip>
);
