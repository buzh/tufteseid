import type { ReactNode } from 'react';
import styles from './Alert.module.css';
import { cx } from './cx';
import { Icon, type MaterialSymbol } from './Icon';

export type AlertTone = 'info' | 'warning';

const TONE_CLASS: Record<AlertTone, string> = {
  info: styles.info,
  warning: styles.warning,
};

const TONE_ICON: Record<AlertTone, MaterialSymbol> = {
  info: 'info',
  warning: 'warning',
};

/*
 * A standing remark about the surface it sits in — the theme-layer count is
 * near the point where the map starts dropping tiles, the coordinate you
 * typed is outside Norway. Not a toast: these do not appear in response to an
 * action and do not go away, so they belong in the flow rather than over it.
 */
export const Alert = ({
  tone = 'info',
  className,
  children,
}: {
  tone?: AlertTone;
  className?: string;
  children: ReactNode;
}) => (
  <div role="note" className={cx(styles.root, TONE_CLASS[tone], className)}>
    <Icon icon={TONE_ICON[tone]} size={16} className={styles.icon} />
    <div className={styles.body}>{children}</div>
  </div>
);
