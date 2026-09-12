import type { ReactNode } from 'react';
import { cx, Icon, Tooltip } from '../ui';
import styles from './EyeSplit.module.css';

/*
 * The ribbon's split control: whatever you pass as children on the left, an
 * eye welded to its right edge. Two of them now — `Funn` and `Kulturminner`
 * — and they are the same idiom rather than two lookalikes, which is why the
 * geometry and the polarity live here instead of in each row's stylesheet.
 *
 * The left half is passed in rather than described by props because the two
 * differ in what they open (a list, a settings panel) and agree on nothing
 * except the seam. Give that half `joinedRight` on its `ModeButton` — that is
 * what squares the shared edge off and pulls the count badge back inside it.
 *
 * Two segments and not an item inside the panel, deliberately. Taking a layer
 * off is something you do *while* dragging the Sammenlign curtain or reading
 * relief, so it has to stay one press; an item in a menu would be three, one
 * of which covers the ground you were looking at. And the count stays legible
 * on the labelled half while the layer is hidden, so hiding never costs you
 * the answer to "is there anything here".
 *
 * No `aria-pressed`: the accessible name is the *verb* and changes with the
 * state, so saying both is how a screen reader ends up announcing "Show the
 * finds on the map, pressed".
 */
export const EyeSplit = ({
  shown,
  label,
  hint,
  children,
  onToggle,
}: {
  /** Whether the thing the eye governs is on the map right now. */
  shown: boolean;
  /** The verb for what a press does, which is also the accessible name. */
  label: string;
  /** Keyboard shortcut, appended to the tooltip in parentheses. */
  hint?: string;
  children: ReactNode;
  onToggle: () => void;
}) => (
  <div className={styles.split}>
    {children}
    <Tooltip label={hint ? `${label} (${hint})` : label}>
      <button
        type="button"
        className={cx(styles.eye, shown && styles.eyeOn)}
        aria-label={label}
        onClick={onToggle}
      >
        <Icon icon={shown ? 'visibility' : 'visibility_off'} size={18} />
      </button>
    </Tooltip>
  </div>
);
