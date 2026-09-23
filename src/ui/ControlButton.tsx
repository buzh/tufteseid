import { UnstyledButton } from '@mantine/core';
import type { ComponentPropsWithoutRef, Ref } from 'react';
import styles from './ControlButton.module.css';
import { cx } from './cx';
import { Icon, type MaterialSymbol } from './Icon';

type ControlButtonProps = ComponentPropsWithoutRef<'button'> & {
  ref?: Ref<HTMLButtonElement>;
} & (
    | {
        icon: MaterialSymbol;
        on?: boolean;
        split?: never;
        lit?: never;
      }
    | {
        split: readonly [MaterialSymbol, MaterialSymbol];
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
