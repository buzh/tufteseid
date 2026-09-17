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

// A standing remark about the surface it sits in. Not a toast: it does not
// follow an action and does not go away, so it sits in the flow.
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
