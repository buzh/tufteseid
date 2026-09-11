import type {
  InputHTMLAttributes,
  KeyboardEvent,
  ReactNode,
  Ref,
} from 'react';
import { useId, useLayoutEffect, useRef } from 'react';
import type { ControlSize } from './Button';
import { cx } from './cx';
import styles from './Field.module.css';

const INPUT_SIZE_CLASS: Record<ControlSize, string> = {
  xs: styles.inputXs,
  sm: '',
  md: styles.inputMd,
};

export const Input = ({
  size = 'sm',
  invalid,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: ControlSize;
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}) => (
  <input
    className={cx(
      styles.control,
      styles.input,
      INPUT_SIZE_CLASS[size],
      invalid && styles.invalid,
      className,
    )}
    {...rest}
  />
);

/*
 * Multi-line input that grows with its content up to `maxRows`, then
 * scrolls. Funn notes are usually one line and occasionally twenty; a fixed
 * two-row box makes the short case look broken and the long case unreadable.
 *
 * The height is measured rather than computed from line counts because the
 * box wraps: `\n` counting gets it wrong for a single long sentence.
 */
export const NoteInput = ({
  value,
  onChange,
  onBlur,
  onKeyDown,
  placeholder,
  minRows = 2,
  maxRows = 12,
  disabled,
  readOnly,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  className?: string;
}) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 18;
    const chrome =
      parseFloat(cs.paddingTop) +
      parseFloat(cs.paddingBottom) +
      parseFloat(cs.borderTopWidth) +
      parseFloat(cs.borderBottomWidth);
    // Collapse first: scrollHeight never shrinks below the current height.
    el.style.height = 'auto';
    const min = line * minRows + chrome;
    const max = line * maxRows + chrome;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`;
  }, [value, minRows, maxRows]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      maxLength={20000}
      disabled={disabled}
      readOnly={readOnly}
      autoFocus={autoFocus}
      className={cx(styles.control, styles.note, className)}
    />
  );
};

// Label / hint / error wrapper. Optional — plenty of ribbon controls are
// labelled by an adjacent icon button instead.
export const Field = ({
  label,
  hint,
  error,
  className,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  className?: string;
  children: (props: { id: string; 'aria-describedby'?: string }) => ReactNode;
}) => {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cx(styles.field, className)}>
      {label && (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      )}
      {children({ id, 'aria-describedby': describedBy })}
      {error ? (
        <span id={`${id}-err`} className={styles.error}>
          {error}
        </span>
      ) : (
        hint && (
          <span id={`${id}-hint`} className={styles.hint}>
            {hint}
          </span>
        )
      )}
    </div>
  );
};
