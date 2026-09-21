// The ribbon's menu target: a label that says what is showing, and a hint under
// it that says how it got there. Two lines because the answer to "what am I
// looking at" is never one word — a dataset without its year and density, or a
// render without whose render it is, does not tell the reader anything.

import { UnstyledButton } from '@mantine/core';
import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import { cx } from '../ui/cx';
import { Icon, type MaterialSymbol } from '../ui/Icon';
import styles from './Ribbon.module.css';

type RibbonChipProps = ComponentPropsWithoutRef<'button'> & {
  icon?: MaterialSymbol;
  label: ReactNode;
  hint?: ReactNode;
  /** Left off where the chip is a readout rather than a menu target. */
  withChevron?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export const RibbonChip = ({
  icon,
  label,
  hint,
  withChevron = true,
  className,
  ...rest
}: RibbonChipProps) => (
  <UnstyledButton className={cx(styles.chip, className)} {...rest}>
    {icon && <Icon icon={icon} size={20} className={styles.chipIcon} />}
    <span className={styles.chipText}>
      <span className={styles.chipLabel}>{label}</span>
      {hint && <span className={styles.chipHint}>{hint}</span>}
    </span>
    {withChevron && (
      <Icon
        icon="keyboard_arrow_down"
        size={18}
        className={styles.chipChevron}
      />
    )}
  </UnstyledButton>
);
