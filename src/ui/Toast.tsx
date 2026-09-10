import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from './Button';
import { cx } from './cx';
import { Icon, type MaterialSymbol } from './Icon';
import styles from './Toast.module.css';

/*
 * Transient message region. Replaces kvib's `toaster` singleton.
 *
 * The store is a plain module-level list rather than an atom: the emitter is
 * called from non-React code (`createFromBbox.ts`, the workspace callbacks),
 * exactly one component ever reads it, and `useSyncExternalStore` covers that
 * without giving the kit a dependency on the app's jotai store.
 *
 * The region is a top-layer `popover`, not a z-index. Toasts are fired from
 * inside modal <dialog>s — a failed save from a lokalitet dialog, say — and
 * anything painted with an ordinary z-index loses to the top layer, i.e. the
 * message would be invisible precisely when it matters. Browsers without the
 * popover API ignore the attribute and fall back to `--z-toast`, which is
 * above everything except a modal.
 *
 * The known edge of that: `showModal()` makes everything outside the dialog
 * inert, the toast included, so while a modal is up the message is readable
 * but its close button is not clickable. It still times out on its own.
 */

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

/**
 * One verb offered alongside the message — in practice, undoing what the
 * message just reported. A toast with an action is how a surface can commit
 * something without asking first: the receipt carries the way back.
 */
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

// Failures get longer than confirmations: a confirmation is a receipt for
// something the user just watched happen, a failure is news.
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

  // An empty popover still paints its own box, so show it only while there is
  // something in it.
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
