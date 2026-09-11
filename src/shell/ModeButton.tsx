import { CountBadge, cx, Icon, type MaterialSymbol, Tooltip } from '../ui';
import styles from './ModeButton.module.css';

export const ModeButton = ({
  icon,
  label,
  tooltip,
  active,
  badge,
  disabled,
  onClick,
}: {
  icon: MaterialSymbol;
  label: string;
  tooltip?: string;
  active?: boolean;
  badge?: number | string;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <Tooltip label={tooltip ?? label}>
    <span className={styles.wrap}>
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
