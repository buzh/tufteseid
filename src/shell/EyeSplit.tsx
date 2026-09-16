import type { ReactNode } from 'react';
import { cx, Icon, Tooltip } from '../ui';
import styles from './EyeSplit.module.css';

/*
 * The ribbon's split control: whatever you pass as children on the left, an
 * eye welded to its right edge.
 *
 * **One caller, and that is the state it settled in.** `Funn` was the other
 * until §13.10 step 4, which made the lokalitet row four layer groups
 * (`LayerGroup`) and took it with them — there the *label* is the switch and
 * the right-hand segment opens the list, which is this control's duties
 * swapped. So the two idioms are now one per row: `EyeSplit` is row 1's, on
 * `Kulturminner`, where the thing being hidden is a global overlay rather than
 * a member of the open lokalitet's stack. Kept as a component rather than
 * folded back into `HeritageControl` because the geometry and the polarity
 * below are the parts that were hard to get right, and they read as rules here
 * and as styling there.
 *
 * The left half is passed in rather than described by props. Give it
 * `joinedRight` on its `ModeButton` — that is what squares the shared edge off
 * and pulls the count badge back inside it.
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
