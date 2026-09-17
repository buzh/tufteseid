import { Fragment, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx, Icon, type MaterialSymbol, Popover, Tooltip } from '../ui';
import styles from './LayerGroup.module.css';
import { ModeButton } from './ModeButton';

/*
 * One `[thing ▾]` on the lokalitet row, used four times over: Visning, Bilde,
 * Skisse, Funn, left to right in the map's z-order. Nothing here writes, so
 * there is no stance gate. The label toggles and the caret opens, the opposite
 * polarity to `EyeSplit`.
 */

export type LayerMember = {
  /** Record id, or a stable key for a member that is not a record. */
  id: string;
  label: string;
  meta?: string;
  shown: boolean;
  /** 0–100, printed as transparency (`100 -` this). Absent means no fade at
   * all: opacity is a raster idea. */
  opacity?: number;
  /** Switched on and nothing arrived. */
  warning?: string;
  /** True of the layer even when it is working. */
  note?: string;
  /** Printed when it differs from the member above, so members must arrive in
   * group order, which is also the paint order (`funnGroups.ts`). */
  section?: string;
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
  label: string;
  /** The verb a press on the button performs, and its accessible name. */
  toggleLabel: string;
  /** Accessible name for the caret and its panel. */
  membersLabel: string;
  /** Keyboard shortcut for the toggle, appended to its tooltip. */
  hint?: string;
  shown: boolean;
  /** How many members are on the map — what is on, not what exists. */
  shownCount: number;
  width?: number;
  padded?: boolean;
  /** A function rather than a node because `FunnList`'s rows fly the map and
   * must close over the dismiss. */
  children: (close: () => void) => ReactNode;
  onToggle: () => void;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.group}>
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

/** The default pulldown body, exported so `FunnList` can bring its own. */
export const LayerMembers = ({
  members,
  select = false,
  onPressMember,
  onSetOpacity,
}: {
  members: readonly LayerMember[];
  /** One member at a time: press to select, not to toggle. */
  select?: boolean;
  onPressMember: (id: string) => void;
  onSetOpacity: (id: string, opacity: number) => void;
}) => (
  <div className={styles.members}>
    {members.map((member, i) => (
      <Fragment key={member.id}>
        {member.section && member.section !== members[i - 1]?.section && (
          <p className={styles.section}>{member.section}</p>
        )}
        <MemberRow
          member={member}
          select={select}
          onPress={() => onPressMember(member.id)}
          onSetOpacity={(value) => onSetOpacity(member.id, value)}
        />
      </Fragment>
    ))}
  </div>
);

/*
 * Not `PulldownCheck` / `PulldownItem`: those rows are a single line and this
 * one grows a slider. The map holds opacity and the screen says transparency;
 * the flip is here.
 */
const MemberRow = ({
  member,
  select,
  onPress,
  onSetOpacity,
}: {
  member: LayerMember;
  select: boolean;
  onPress: () => void;
  onSetOpacity: (opacity: number) => void;
}) => {
  const { t } = useTranslation();
  const transparency = member.opacity == null ? null : 100 - member.opacity;

  return (
    <div
      className={cx(
        styles.member,
        select && styles.selectable,
        select && member.shown && styles.memberSelected,
      )}
    >
      <div className={styles.head}>
        <button
          type="button"
          role={select ? 'menuitemradio' : 'menuitemcheckbox'}
          aria-checked={member.shown}
          className={styles.switch}
          onClick={onPress}
        >
          {!select && (
            <Icon
              icon={member.shown ? 'check_box' : 'check_box_outline_blank'}
              size={18}
              className={member.shown ? styles.checkOn : styles.checkOff}
            />
          )}
          <span className={styles.memberLabel}>
            {member.label}
            {member.meta && (
              <span className={styles.memberMeta}>{member.meta}</span>
            )}
            {member.note && (
              <span className={styles.memberNote}>
                <Icon icon="info" size={14} />
                {member.note}
              </span>
            )}
            {member.warning && (
              <span className={styles.memberWarning}>
                <Icon icon="error" size={14} />
                {member.warning}
              </span>
            )}
          </span>
        </button>
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
