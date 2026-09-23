// Callers put the long form in `title`/`aria-label`, not a Mantine `Tooltip`:
// `Menu.Target` and `Tooltip` both clone their single child and do not nest.

import { UnstyledButton } from '@mantine/core';
import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import styles from './ControlChip.module.css';
import { cx } from './cx';
import { Icon, type MaterialSymbol } from './Icon';

type ControlChipProps = ComponentPropsWithoutRef<'button'> & {
  icon?: MaterialSymbol;
  label?: ReactNode;
  hint?: ReactNode;
  withChevron?: boolean;
  dimmed?: boolean;
  readout?: boolean;
  warn?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export const ControlChip = ({
  icon,
  label,
  hint,
  withChevron = true,
  dimmed = false,
  readout = false,
  warn = false,
  className,
  ...rest
}: ControlChipProps) => {
  const bare = !icon && !label && !hint;

  return (
    <UnstyledButton
      className={cx(
        styles.chip,
        bare && styles.chipBare,
        dimmed && styles.chipDimmed,
        readout && styles.chipReadout,
        warn && styles.chipWarn,
        className,
      )}
      {...rest}
    >
      {icon && <Icon icon={icon} size={18} className={styles.chipIcon} />}
      {label && <span className={styles.chipLabel}>{label}</span>}
      {hint && <span className={styles.chipHint}>{hint}</span>}
      {withChevron && (
        // `Icon` writes its size inline, so a stylesheet rule would lose to it.
        <Icon
          icon="keyboard_arrow_down"
          size={bare ? 12 : 16}
          className={styles.chipChevron}
        />
      )}
    </UnstyledButton>
  );
};
