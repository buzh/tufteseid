import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { Icon, type MaterialSymbol } from './Icon';
import styles from './Menu.module.css';
import { Popover } from './Popover';

/*
 * A popover holding a list of verbs — "the rest of what you can do to this
 * thing". Sits on Popover, so it inherits the portal, the outside-press
 * dismissal, the focus handling and the `data-scope="popover"` the keyboard
 * layers walk for (see Popover.tsx).
 *
 * Items are data rather than children, so the menu can own the three things
 * every call site was otherwise copying: holding `open`, closing itself
 * before the verb runs, and swapping its own body for a confirm question.
 *
 * That last one is why this exists alongside `ConfirmPopover` rather than
 * using it: a destructive *item* that opened a second popover would stack two
 * overlays over the thing being deleted. `confirm` replaces the list in place
 * instead — the same shape the funn row menu and the lokalitet overflow menu
 * had each hand-rolled.
 *
 * Labels are props, not t() calls: src/ui/ stays free of i18next so the kit
 * can be lifted somewhere else unchanged.
 */

export type MenuConfirm = {
  title: string;
  confirmLabel: string;
  cancelLabel: string;
};

export type MenuItemSpec = {
  /** Leading glyph. Omit where the label is already a graphic (a Badge). */
  icon?: MaterialSymbol;
  label: ReactNode;
  /** Reads as selected — the status a funn already has, the tool already on. */
  active?: boolean;
  /** Destructive: red label. */
  danger?: boolean;
  disabled?: boolean;
  /** Ask first. Replaces the menu body with the question until answered. */
  confirm?: MenuConfirm;
  onSelect: () => void;
};

export type MenuTriggerProps = {
  /*
   * For `aria-expanded`, and for triggers that light up while their menu is
   * down (ModeButton's `active`) — which is why this is `open` and not
   * `'aria-expanded'`: one name for one fact, read rather than spread.
   */
  open: boolean;
  /*
   * Toggles the menu. Typed to take an optional event rather than none so
   * both kinds of trigger fit: a plain <button> hands its click over — and a
   * menu anchored inside a clickable row needs that click stopped, or the row
   * fires too — while ModeButton's `onClick: () => void` declares none.
   */
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
  /** Called with the state the trigger control has to reflect. */
  trigger: (props: MenuTriggerProps) => ReactNode;
  /*
   * Falsy entries are dropped, so a conditional item is
   * `cond && { … }` inline. Their slots stay put, which is what makes the
   * index a stable key.
   */
  items: (MenuItemSpec | false | null | undefined)[];
  /** Heading above the list, where the items need naming as a set. */
  title?: string;
  align?: 'start' | 'center' | 'end';
  width?: number;
  /** Accessible name for the panel. */
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
