// A menu target for a row of map controls: one line, the height of the buttons
// beside it, said in as few characters as the axis allows. A chip is a readout
// of what is showing, not a description of how it got there — the full name of
// a flight and the provenance of a render belong in the menu the chip opens,
// and repeating them here costs the row a second line and the map the room.
//
// What the chip leaves out goes in `title` and `aria-label`, so it is still one
// hover away. Not a Mantine `Tooltip`: `Menu.Target` and `Tooltip` both clone
// their single child, and nesting the two is undocumented in both directions.
//
// Every variant is a boolean prop rather than a class the caller passes: the
// stylesheet is a CSS module, so a class named in the caller's own module would
// hash to something the rules in here never see.

import { UnstyledButton } from '@mantine/core';
import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import styles from './ControlChip.module.css';
import { cx } from './cx';
import { Icon, type MaterialSymbol } from './Icon';

type ControlChipProps = ComponentPropsWithoutRef<'button'> & {
  icon?: MaterialSymbol;
  /** Left off where the icon is the whole readout. */
  label?: ReactNode;
  /** Trails the label in the dimmed colour, on the same line. */
  hint?: ReactNode;
  /** Left off where the chip is a readout rather than a menu target. */
  withChevron?: boolean;
  /**
   * Something other than the reader chose this — Automatisk, or a clamp. Dims
   * the chip without closing it: it still opens, and picking something is how
   * the wheel is taken back.
   */
  dimmed?: boolean;
  /** Says what is showing and does not open. Drops the hover affordance. */
  readout?: boolean;
  /** An upstream is down. Red border and icon, nothing else. */
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
}: ControlChipProps) => (
  <UnstyledButton
    className={cx(
      styles.chip,
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
      <Icon
        icon="keyboard_arrow_down"
        size={16}
        className={styles.chipChevron}
      />
    )}
  </UnstyledButton>
);
