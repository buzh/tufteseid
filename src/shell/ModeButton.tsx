import { CountBadge, cx, Icon, type MaterialSymbol, Tooltip } from '../ui';
import styles from './ModeButton.module.css';

export const ModeButton = ({
  icon,
  label,
  tooltip,
  active,
  badge,
  disabled,
  joinedRight,
  onClick,
}: {
  icon: MaterialSymbol;
  label: string;
  tooltip?: string;
  active?: boolean;
  badge?: number | string;
  disabled?: boolean;
  /** This button is the left half of a split control and something is butted
   *  against it — square that edge off and pull the badge in off it. The only
   *  one is `Funn` and its eye (RibbonLocalityRow). */
  joinedRight?: boolean;
  onClick: () => void;
}) => (
  <Tooltip label={tooltip ?? label}>
    <span className={cx(styles.wrap, joinedRight && styles.joinedRight)}>
      <button
        type="button"
        className={cx(styles.button, active && styles.active)}
        aria-pressed={active}
        aria-label={tooltip ?? label}
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
