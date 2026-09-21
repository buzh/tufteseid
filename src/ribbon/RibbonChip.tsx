// The ribbon's menu target: one line, the height of the buttons beside it, said
// in as few characters as the axis allows. A chip is a readout of what is
// showing, not a description of how it got there — the full name of a flight
// and the provenance of a render belong in the menu the chip opens, and
// repeating them here costs the band a second line and the map the room.
//
// What the chip leaves out goes in `title` and `aria-label`, so it is still one
// hover away. Not a Mantine `Tooltip`: `Menu.Target` and `Tooltip` both clone
// their single child, and nesting the two is undocumented in both directions.

import { UnstyledButton } from '@mantine/core';
import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import { cx } from '../ui/cx';
import { Icon, type MaterialSymbol } from '../ui/Icon';
import styles from './Ribbon.module.css';

type RibbonChipProps = ComponentPropsWithoutRef<'button'> & {
  icon?: MaterialSymbol;
  /** Left off where the icon is the whole readout. */
  label?: ReactNode;
  /** Trails the label in the dimmed colour, on the same line. */
  hint?: ReactNode;
  /** Left off where the chip is a readout rather than a menu target. */
  withChevron?: boolean;
  /**
   * Automatisk chose this, not the reader. Dims the chip without closing it —
   * it still opens, and picking something is how the wheel is taken back.
   */
  dimmed?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export const RibbonChip = ({
  icon,
  label,
  hint,
  withChevron = true,
  dimmed = false,
  className,
  ...rest
}: RibbonChipProps) => (
  <UnstyledButton
    className={cx(styles.chip, dimmed && styles.chipDimmed, className)}
    {...rest}
  >
    {icon && <Icon icon={icon} size={18} className={styles.chipIcon} />}
    {label && <span className={styles.chipLabel}>{label}</span>}
    {hint && <span className={styles.chipHint}>{hint}</span>}
    {withChevron && (
      <Icon
        icon="keyboard_arrow_down"
        size={16}
        className={styles.chipChevron}
      />
    )}
  </UnstyledButton>
);
