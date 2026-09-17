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
   * The accessible name, for a toggle whose tooltip is a verb that flips with
   * `active`: pass the stable noun here and let `aria-pressed` carry the rest,
   * or it announces "Hide the finds, pressed".
   */
  ariaLabel?: string;
  active?: boolean;
  badge?: number | string;
  disabled?: boolean;
  /** Left half of a split control (`LayerGroup`): square that edge off and
   *  pull the badge in off it. */
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
