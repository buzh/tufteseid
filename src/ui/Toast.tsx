import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from './Button';
import { cx } from './cx';
import { Icon, type MaterialSymbol } from './Icon';
import styles from './Toast.module.css';

// The store is module-level rather than an atom because the emitter is called
// from non-React code.
//
// A top-layer `popover`, not a z-index: toasts are fired from inside modal
// <dialog>s, which the top layer paints over (`--z-toast` is the fallback).
// Known edge: a modal makes everything outside it inert, so the toast's close
// button is unclickable while one is up, though it still times out.

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

/** One verb alongside the message — in practice, undo. */
export type ToastAction = {
  label: string;
  /** The toast dismisses itself first, then this runs. */
  onClick: () => void;
};

export type ToastOptions = {
  title: string;
  description?: string;
  /** Milliseconds; 0 keeps it up until dismissed. Defaults per tone. */
  duration?: number;
  action?: ToastAction;
};

type ToastItem = ToastOptions & { id: number; tone: ToastTone };

// Failures stay up longer than confirmations.
const DEFAULT_DURATION: Record<ToastTone, number> = {
  info: 4000,
  success: 4000,
  warning: 6000,
  error: 6000,
};

const TONE_ICON: Record<ToastTone, MaterialSymbol> = {
  info: 'info',
  success: 'check_circle',
  warning: 'warning',
  error: 'error',
};

const TONE_CLASS: Record<ToastTone, string> = {
  info: styles.info,
  success: styles.success,
  warning: styles.warning,
  error: styles.error,
};

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => items;

const dismiss = (id: number) => {
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
};

const push = (tone: ToastTone, options: ToastOptions) => {
  const id = nextId++;
  items = [...items, { ...options, id, tone }];
  emit();
  const duration = options.duration ?? DEFAULT_DURATION[tone];
  if (duration > 0) window.setTimeout(() => dismiss(id), duration);
  return id;
};

export const toast = {
  create: (options: ToastOptions) => push('info', options),
  success: (options: ToastOptions) => push('success', options),
  warning: (options: ToastOptions) => push('warning', options),
  error: (options: ToastOptions) => push('error', options),
  dismiss,
};

/** Mount once, near the root. */
export const Toaster = ({ closeLabel = 'Lukk' }: { closeLabel?: string }) => {
  const list = useSyncExternalStore(subscribe, getSnapshot);
  const ref = useRef<HTMLDivElement>(null);
  const hasItems = list.length > 0;

  // An empty popover still paints its own box.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== 'function') return;
    const isOpen = el.matches(':popover-open');
    if (hasItems && !isOpen) el.showPopover();
    else if (!hasItems && isOpen) el.hidePopover();
  }, [hasItems]);

  return createPortal(
    <div ref={ref} popover="manual" className={styles.region}>
      {list.map((item) => (
        <div
          key={item.id}
          className={cx(styles.toast, TONE_CLASS[item.tone])}
          role={item.tone === 'error' ? 'alert' : 'status'}
          aria-live={item.tone === 'error' ? 'assertive' : 'polite'}
        >
          <Icon
            icon={TONE_ICON[item.tone]}
            size={18}
            filled
            className={styles.glyph}
          />
          <div className={styles.body}>
            <div className={styles.title}>{item.title}</div>
            {item.description && (
              <div className={styles.description}>{item.description}</div>
            )}
          </div>
          {item.action && (
            <Button
              size="xs"
              variant="secondary"
              className={styles.action}
              onClick={() => {
                dismiss(item.id);
                item.action?.onClick();
              }}
            >
              {item.action.label}
            </Button>
          )}
          <IconButton
            icon="close"
            aria-label={closeLabel}
            size="xs"
            palette="gray"
            onClick={() => dismiss(item.id)}
          />
        </div>
      ))}
    </div>,
    document.body,
  );
};
