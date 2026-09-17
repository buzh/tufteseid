import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button } from './Button';
import styles from './ConfirmPopover.module.css';
import { Popover } from './Popover';

// Destructive confirm anchored to its trigger, so the thing being deleted
// stays visible behind it. Labels are props, not t() calls — src/ui/ stays
// free of i18next.
export const ConfirmPopover = ({
  trigger,
  title,
  confirmLabel,
  cancelLabel,
  onConfirm,
}: {
  /** Called with the props the trigger control has to spread onto itself. */
  trigger: (props: {
    onClick: () => void;
    'aria-expanded': boolean;
  }) => ReactNode;
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={260}
      label={title}
      trigger={trigger({
        onClick: () => setOpen((o) => !o),
        'aria-expanded': open,
      })}
    >
      <p className={styles.title}>{title}</p>
      <div className={styles.actions}>
        <Button size="xs" palette="gray" onClick={() => setOpen(false)}>
          {cancelLabel}
        </Button>
        <Button
          size="xs"
          variant="primary"
          palette="red"
          onClick={() => {
            setOpen(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Popover>
  );
};
