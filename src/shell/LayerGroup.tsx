import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  cx,
  Icon,
  IconButton,
  type MaterialSymbol,
  Popover,
  Tooltip,
} from '../ui';
import styles from './LayerGroup.module.css';
import { ModeButton } from './ModeButton';

/*
 * One `[thing ▾]` on the lokalitet row — docs/lokalitet-view.md §13.1, §13.10
 * steps 3 and 4.
 *
 * The row is four of these, left to right in the map's own z-order: Visning,
 * Bilde, Skisse, Funn. So this component is the whole layer row, used four
 * times, and what it is is a *button*: a labelled half that takes the group
 * off the map, a caret that opens what is in it, and a badge saying how much
 * of it is up. Nothing here knows what a sketch or a funn is.
 *
 * **What goes in the pulldown is the caller's.** `LayerMembers` below is the
 * default body and does the job for a group whose members are nothing but
 * layers — a switch and a fade each. `[Funn]` is the one group whose members
 * are also *records you act on* (rename, restage, redraw, delete), so it
 * brings `FunnList` instead, switches and all. Splitting it that way is step
 * 4's finding: the shared thing was never the rows, it was the seam.
 *
 * **The label toggles, the caret opens.** That is the opposite polarity to
 * `EyeSplit`, whose labelled half opens a list and whose eye hides it. Having
 * both idioms on one screen was tolerable while `Funn` was the odd one out;
 * with `Funn` re-clothed the lokalitet row speaks this one throughout and
 * `EyeSplit` is row 1's, on `Kulturminner`. The seam geometry stays duplicated
 * between the two: what they share is ten lines of flex and a border radius,
 * and what they differ in — width, glyph, and which state is lit — is
 * everything that gives either one its meaning.
 *
 * Nothing in here writes (§13.8), so there is no stance gate anywhere in the
 * component: a reader gets the row at full function.
 */

export type LayerMember = {
  /** Record id, or a stable key for a member that is not a record. */
  id: string;
  /**
   * What this layer *is*. Under §13.4 this is the only provenance on screen —
   * dataset, acquisition, knobs — so a group whose rows all read the same word
   * is this design failing. Callers own it for that reason.
   */
  label: string;
  /** The second line, when the label cannot carry all of it. */
  meta?: string;
  shown: boolean;
  /**
   * 0–100, printed as transparency (`100 -` this). **Optional, and absent
   * means no fade at all** — step 4's rule that opacity is a raster idea, said
   * once more for a raster that happens not to have one knob: [Visning]'s
   * ground preset is a *stack* of tile layers, so fading it is three fades and
   * not one, and the grounds that do fade already have that control where all
   * their other modifiers are, on the settings strip.
   */
  opacity?: number;
  /**
   * One verb the row carries, at its right edge.
   *
   * There is exactly one so far and it is `Gjenskap` (§13.2): the button left
   * the bilde card when [Visning] arrived and became this, the pulldown's
   * apply. A member that has no view behind it — a File, the ground preset —
   * leaves it out, which is the same "absent, not disabled" the card made.
   */
  action?: { icon: MaterialSymbol; label: string; onClick: () => void };
  /**
   * Switched on, and nothing arrived.
   *
   * A layer that is on but invisible is the one state a row of switches cannot
   * say by itself, and it is reachable: a File whose bytes will not decode, a
   * View whose upstream has nothing over this rectangle (`useGroundView`
   * returns exactly that as `failed`). This is where the note that used to sit
   * under the selected card went when step 6 took the card's ground verbs —
   * onto the switch that is claiming the layer is up.
   */
  warning?: string;
};

export const LayerGroup = ({
  icon,
  label,
  toggleLabel,
  membersLabel,
  hint,
  shown,
  shownCount,
  width = 320,
  padded = false,
  children,
  onToggle,
}: {
  icon: MaterialSymbol;
  /** The group's name, on the button. */
  label: string;
  /** The verb a press on that button performs, and its accessible name. */
  toggleLabel: string;
  /** Accessible name for the caret and its panel. */
  membersLabel: string;
  /** Keyboard shortcut for the toggle, appended to its tooltip. */
  hint?: string;
  shown: boolean;
  /** How many members are on the map. See the badge note below. */
  shownCount: number;
  /** The pulldown's geometry, for a body that is not `LayerMembers`. */
  width?: number;
  padded?: boolean;
  /**
   * The pulldown's contents, given a way to dismiss it.
   *
   * A function rather than a node because `FunnList`'s rows fly the map to a
   * funn, and a pulldown left standing over the place it just flew to is the
   * one outcome that gesture cannot want. The alternative — the caller owning
   * `open` and passing it down — is what this component exists to stop four
   * rows from each doing.
   */
  children: (close: () => void) => ReactNode;
  onToggle: () => void;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.group}>
      {/* The badge counts what is *on*, not what exists, and goes away with
          the group. The other counted button on this row, `Bilder ▾`, answers
          "is there anything here" — that is what a rail is for — and a layer
          switch is only ever asked "how much of it am I looking at".

          For `Funn` that is a change of meaning with almost no change of
          number: every funn is on unless you switched it off, so the badge
          still answers "does this rectangle have anything in it" in the
          ordinary case, which is the property §6 wanted from it. */}
      <ModeButton
        icon={icon}
        label={label}
        tooltip={hint ? `${toggleLabel} (${hint})` : toggleLabel}
        ariaLabel={label}
        active={shown}
        badge={shown ? shownCount || undefined : undefined}
        joinedRight
        onClick={onToggle}
      />
      <Popover
        open={open}
        onOpenChange={setOpen}
        width={width}
        padded={padded}
        label={membersLabel}
        trigger={
          <Tooltip label={membersLabel}>
            <button
              type="button"
              className={cx(styles.caret, open && styles.caretOpen)}
              aria-label={membersLabel}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <Icon icon="arrow_drop_down" size={20} />
            </button>
          </Tooltip>
        }
      >
        {children(() => setOpen(false))}
      </Popover>
    </div>
  );
};

/**
 * The default pulldown body: a switch and a fade per member.
 *
 * Exported separately from `LayerGroup` so that a group with a body of its own
 * does not have to pretend its records are plain layers — see the note above.
 */
export const LayerMembers = ({
  members,
  onToggleMember,
  onSetOpacity,
}: {
  members: readonly LayerMember[];
  onToggleMember: (id: string) => void;
  onSetOpacity: (id: string, opacity: number) => void;
}) => (
  <div className={styles.members}>
    {members.map((member) => (
      <MemberRow
        key={member.id}
        member={member}
        onToggle={() => onToggleMember(member.id)}
        onSetOpacity={(value) => onSetOpacity(member.id, value)}
      />
    ))}
  </div>
);

/*
 * A switch and a fade, per member.
 *
 * The switch is a checkbox rather than a `PulldownItem`'s left bar for the
 * reason `PulldownCheck` gives: several rows are on at once, and a bar that
 * says "this is the one" says the wrong thing about the other three. It is not
 * `PulldownCheck` itself because that row is a single line and this one grows
 * a slider under it.
 *
 * The slider is absent rather than disabled while the member is off — a fade
 * that cannot be seen is indistinguishable from a fade that does nothing, the
 * same call `TerrainSliders` makes — and it streams, because what is being
 * watched is the layer underneath coming through and a fade that only lands on
 * release cannot be aimed. A member with no `opacity` at all never grows one.
 *
 * The switch fills the row, and an action sits beside it rather than in it: a
 * `<button>` cannot contain a `<button>`, so `.head` is the flex line the two
 * share. That is also why the action is not part of the switch's hit area —
 * `Gjenskap` moves the map, and a press meant for a checkbox must not.
 *
 * **0 % is opaque.** The word on screen is transparency, so the number counts
 * what the word names; the map holds opacity and the flip is here, at the
 * surface that prints the word. The terrain strip says the same thing the same
 * way; `BildeTransparency`, which was the third, is what step 6 deleted — a
 * fade for the one image on the ground, anchored to the rectangle's corner,
 * replaced by a fade per member where the member's switch is.
 */
const MemberRow = ({
  member,
  onToggle,
  onSetOpacity,
}: {
  member: LayerMember;
  onToggle: () => void;
  onSetOpacity: (opacity: number) => void;
}) => {
  const { t } = useTranslation();
  const { action } = member;
  const transparency = member.opacity == null ? null : 100 - member.opacity;

  return (
    <div className={styles.member}>
      <div className={styles.head}>
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={member.shown}
          className={styles.switch}
          onClick={onToggle}
        >
          <Icon
            icon={member.shown ? 'check_box' : 'check_box_outline_blank'}
            size={18}
            className={member.shown ? styles.checkOn : styles.checkOff}
          />
          <span className={styles.memberLabel}>
            {member.label}
            {member.meta && (
              <span className={styles.memberMeta}>{member.meta}</span>
            )}
            {member.warning && (
              <span className={styles.memberWarning}>
                <Icon icon="error" size={14} />
                {member.warning}
              </span>
            )}
          </span>
        </button>
        {action && (
          <Tooltip label={action.label}>
            <IconButton
              icon={action.icon}
              size="sm"
              palette="gray"
              className={styles.action}
              aria-label={action.label}
              onClick={action.onClick}
            />
          </Tooltip>
        )}
      </div>
      {member.shown && transparency != null && (
        <label className={styles.fade}>
          <span className={styles.fadeLabel}>
            {t('localities.layers.transparency')}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={transparency}
            onChange={(e) => onSetOpacity(100 - Number(e.target.value))}
          />
          <span className={styles.fadeValue}>{transparency} %</span>
        </label>
      )}
    </div>
  );
};
