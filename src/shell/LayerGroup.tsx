import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cx, Icon, type MaterialSymbol, Popover, Tooltip } from '../ui';
import styles from './LayerGroup.module.css';
import { ModeButton } from './ModeButton';

/*
 * One `[thing ▾]` on the lokalitet row — docs/lokalitet-view.md §13.1, §13.10
 * step 3.
 *
 * The row is four of these, left to right in the map's own z-order: Visning,
 * Bilde, Skisse, Funn. So this component is the whole layer row, used four
 * times, and its props are the abstraction: an ordered list of members, and
 * the three things that can be done to them. Nothing here knows what a sketch
 * is. If a prop ever needs to, that is the signal that the row has stopped
 * being one control.
 *
 * **The label toggles, the caret opens.** That is the opposite polarity to
 * `EyeSplit`, whose labelled half opens a list and whose eye hides it, and the
 * difference is which of the two is the everyday press: on `Funn` it is "show
 * me the index", here it is "take this layer off so I can see what is under
 * it". The seam geometry is duplicated from `EyeSplit.module.css` rather than
 * shared, deliberately and temporarily — step 4 re-clothes `Funn` as one of
 * these, and *that* is the step with two real cases in front of it and the
 * standing to decide whether one frame serves both.
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
  /** 0–100. Printed as transparency, which is `100 -` this. */
  opacity: number;
};

export const LayerGroup = ({
  icon,
  label,
  toggleLabel,
  membersLabel,
  shown,
  members,
  onToggle,
  onToggleMember,
  onSetOpacity,
}: {
  icon: MaterialSymbol;
  /** The group's name, on the button. */
  label: string;
  /** The verb a press on that button performs, and its accessible name. */
  toggleLabel: string;
  /** Accessible name for the caret and its panel. */
  membersLabel: string;
  shown: boolean;
  members: readonly LayerMember[];
  onToggle: () => void;
  onToggleMember: (id: string) => void;
  onSetOpacity: (id: string, opacity: number) => void;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.group}>
      {/* The badge counts what is *on*, not what exists. The other two counted
          buttons on this row answer "is there anything here" — that is what a
          rail and an index are for — and this one answers "how much of it am I
          looking at", which is the only question a layer switch is asked. */}
      <ModeButton
        icon={icon}
        label={label}
        tooltip={toggleLabel}
        active={shown}
        badge={
          shown ? members.filter((m) => m.shown).length || undefined : undefined
        }
        joinedRight
        onClick={onToggle}
      />
      <Popover
        open={open}
        onOpenChange={setOpen}
        width={320}
        padded={false}
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
      </Popover>
    </div>
  );
};

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
 * release cannot be aimed.
 *
 * **0 % is opaque.** The word on screen is transparency, so the number counts
 * what the word names; the map holds opacity and the flip is here, at the
 * surface that prints the word. `BildeTransparency` and the terrain strip say
 * the same thing the same way.
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
  const transparency = 100 - member.opacity;

  return (
    <div className={styles.member}>
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
        </span>
      </button>
      {member.shown && (
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
