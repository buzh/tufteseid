// The second shape in a row of map controls: a fixed square holding one glyph,
// where `ControlChip` is a line of text that grows to fit what it is reporting.
// A chip says what is showing and opens something; a button is the whole control
// — one click, one axis, and the state readable off the box.
//
// Two faces, and a control has exactly one of them:
//
//   `icon` + `on`     a mode, filled in papaya while it is on
//   `split` + `lit`   two states that are one picture, stacked, the live one lit
//
// The type is a union rather than four optional props so a caller cannot ask for
// both at once; every variant is a prop rather than a class the caller passes,
// because the stylesheet is a CSS module and a class named in the caller's own
// module would hash to something the rules in here never see.
//
// No tooltip in here. Both callers wrap this in one, but what the tooltip says
// changes with the state — it is the sentence the glyph cannot carry — so it
// belongs where that state is known, not in the box.

import { UnstyledButton } from '@mantine/core';
import type { ComponentPropsWithoutRef, Ref } from 'react';
import styles from './ControlButton.module.css';
import { cx } from './cx';
import { Icon, type MaterialSymbol } from './Icon';

type ControlButtonProps = ComponentPropsWithoutRef<'button'> & {
  ref?: Ref<HTMLButtonElement>;
} & (
    | {
        /** The one glyph. */
        icon: MaterialSymbol;
        /** The mode is on. Fills the box. */
        on?: boolean;
        split?: never;
        lit?: never;
      }
    | {
        /** Upper glyph, lower glyph. */
        split: readonly [MaterialSymbol, MaterialSymbol];
        /** Which of the two is drawing. */
        lit: 'upper' | 'lower';
        icon?: never;
        on?: never;
      }
  );

export const ControlButton = ({
  icon,
  on = false,
  split,
  lit,
  className,
  ...rest
}: ControlButtonProps) => (
  <UnstyledButton
    className={cx(
      styles.button,
      on && styles.buttonOn,
      split && styles.split,
      className,
    )}
    {...rest}
  >
    {icon && <Icon icon={icon} size={18} />}
    {split && (
      <>
        <span className={cx(styles.half, lit === 'upper' && styles.halfLit)}>
          <Icon icon={split[0]} size={14} />
        </span>
        <span className={cx(styles.half, lit === 'lower' && styles.halfLit)}>
          <Icon icon={split[1]} size={14} />
        </span>
      </>
    )}
  </UnstyledButton>
);
