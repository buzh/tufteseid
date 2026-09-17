import type { ReactNode } from 'react';
import { cx, Icon, Tooltip } from '../ui';
import styles from './EyeSplit.module.css';

/*
 * The ribbon's split control: children on the left, an eye welded to the right
 * edge. Row 1's idiom, one caller (`HeritageControl`) — the lokalitet row uses
 * `LayerGroup`, which has the two duties the other way round.
 *
 * The left half is passed in rather than described by props; give its
 * `ModeButton` `joinedRight` to square the shared edge and pull the count
 * badge inside it.
 *
 * No `aria-pressed`: the accessible name is the verb and changes with the
 * state, so both would announce as "Show the finds on the map, pressed".
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
