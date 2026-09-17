import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { Icon, type MaterialSymbol } from './Icon';
import styles from './Menu.module.css';
import { Popover } from './Popover';

// On Popover, so it inherits the portal, the outside-press dismissal, the
// focus handling and `data-scope="popover"`. `confirm` replaces the list in
// place: a second overlay would stack over the thing being deleted.
// Labels are props, not t() calls — src/ui/ stays free of i18next.

export type MenuConfirm = {
  title: string;
  confirmLabel: string;
  cancelLabel: string;
};

export type MenuItemSpec = {
  /** Leading glyph. Omit where the label is already a graphic (a Badge). */
  icon?: MaterialSymbol;
  label: ReactNode;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Ask first. Replaces the menu body with the question until answered. */
  confirm?: MenuConfirm;
  onSelect: () => void;
};

export type MenuTriggerProps = {
  /** For `aria-expanded`, and for triggers that light up while open. */
  open: boolean;
  /** Optional event so a menu inside a clickable row can stop it. */
  onClick: (e?: { stopPropagation: () => void }) => void;
};

export const Menu = ({
  trigger,
  items,
  title,
  align = 'start',
  width,
  label,
}: {
  trigger: (props: MenuTriggerProps) => ReactNode;
  /** Falsy entries are dropped but keep their slot, so the index is a key. */
  items: (MenuItemSpec | false | null | undefined)[];
  /** Heading above the list, where the items need naming as a set. */
  title?: string;
  align?: 'start' | 'center' | 'end';
  width?: number;
  label: string;
}) => {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<{
    spec: MenuConfirm;
    onConfirm: () => void;
  } | null>(null);

  const close = () => {
    setOpen(false);
    setConfirming(null);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirming(null);
      }}
      align={align}
      width={width}
      label={label}
      trigger={trigger({
        open,
        onClick: (e) => {
          e?.stopPropagation();
          setOpen(!open);
        },
      })}
    >
      {/* The panel is portalled to <body>, but React events still bubble up
          the component *tree* — so without this a menu anchored in a
          clickable row fires that row's handler as well as the item's. */}
      <div onClick={(e) => e.stopPropagation()}>
        {confirming ? (
          <>
            <p className={styles.title}>{confirming.spec.title}</p>
            <div className={styles.confirmActions}>
              <Button
                size="xs"
                palette="gray"
                onClick={() => setConfirming(null)}
              >
                {confirming.spec.cancelLabel}
              </Button>
              <Button
                size="xs"
                variant="primary"
                palette="red"
                onClick={() => {
                  close();
                  confirming.onConfirm();
                }}
              >
                {confirming.spec.confirmLabel}
              </Button>
            </div>
          </>
        ) : (
          <>
            {title && <p className={styles.title}>{title}</p>}
            <div className={styles.list}>
              {items.map((item, i) =>
                item ? (
                  <button
                    key={i}
                    type="button"
                    className={cx(
                      styles.item,
                      item.active && styles.itemActive,
                      item.danger && styles.itemDanger,
                    )}
                    disabled={item.disabled}
                    onClick={() => {
                      if (item.confirm) {
                        setConfirming({
                          spec: item.confirm,
                          onConfirm: item.onSelect,
                        });
                      } else {
                        close();
                        item.onSelect();
                      }
                    }}
                  >
                    {item.icon && <Icon icon={item.icon} size={16} />}
                    {item.label}
                  </button>
                ) : null,
              )}
            </div>
          </>
        )}
      </div>
    </Popover>
  );
};
