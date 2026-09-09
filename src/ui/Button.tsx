import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import styles from './Button.module.css';
import { cx } from './cx';
import { Icon, type MaterialSymbol } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonPalette = 'green' | 'gray' | 'red' | 'blue';
export type ControlSize = 'xs' | 'sm' | 'md';

const PALETTE_CLASS: Record<ButtonPalette, string> = {
  green: styles.paletteGreen,
  gray: styles.paletteGray,
  red: styles.paletteRed,
  blue: styles.paletteBlue,
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
};

const SIZE_CLASS: Record<ControlSize, string> = {
  xs: styles.xs,
  sm: styles.sm,
  md: styles.md,
};

// Glyph sizes that sit right in each control height.
const ICON_SIZE: Record<ControlSize, number> = { xs: 14, sm: 16, md: 18 };

type BaseProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: ButtonVariant;
  palette?: ButtonPalette;
  size?: ControlSize;
  ref?: Ref<HTMLButtonElement>;
};

export const Button = ({
  variant = 'ghost',
  palette = 'green',
  size = 'sm',
  leftIcon,
  rightIcon,
  fullWidth,
  className,
  type = 'button',
  children,
  ...rest
}: BaseProps & {
  leftIcon?: MaterialSymbol;
  rightIcon?: MaterialSymbol;
  fullWidth?: boolean;
  children?: ReactNode;
}) => (
  <button
    type={type}
    className={cx(
      styles.button,
      SIZE_CLASS[size],
      VARIANT_CLASS[variant],
      PALETTE_CLASS[palette],
      fullWidth && styles.full,
      className,
    )}
    {...rest}
  >
    {leftIcon && <Icon icon={leftIcon} size={ICON_SIZE[size]} />}
    {children}
    {rightIcon && <Icon icon={rightIcon} size={ICON_SIZE[size]} />}
  </button>
);

// Square icon-only button. `aria-label` is required, not optional — the
// glyph is aria-hidden, so without it the control has no accessible name.
export const IconButton = ({
  icon,
  'aria-label': ariaLabel,
  variant = 'ghost',
  palette = 'green',
  size = 'sm',
  filled,
  iconSize,
  className,
  type = 'button',
  ...rest
}: BaseProps & {
  icon: MaterialSymbol;
  'aria-label': string;
  filled?: boolean;
  iconSize?: number;
}) => (
  <button
    type={type}
    aria-label={ariaLabel}
    className={cx(
      styles.button,
      styles.iconOnly,
      SIZE_CLASS[size],
      VARIANT_CLASS[variant],
      PALETTE_CLASS[palette],
      className,
    )}
    {...rest}
  >
    <Icon icon={icon} size={iconSize ?? ICON_SIZE[size] + 2} filled={filled} />
  </button>
);
