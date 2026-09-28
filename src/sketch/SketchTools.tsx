import { Popover, Tooltip } from '@mantine/core';
import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  ControlButton,
  ControlUnit,
  cx,
  Icon,
  type MaterialSymbol,
} from '../ui';
import {
  LINEAR_TOOLS,
  PEN_COLOURS,
  PEN_WIDTHS,
  SHAPE_TOOLS,
  type Pen,
} from './pen';
import styles from './SketchTools.module.css';
import type { BoxTool, Live, SketchStyle } from './toolbox';

const ICONS: Record<BoxTool, MaterialSymbol> = {
  hand: 'pan_tool',
  selection: 'arrow_selector_tool',
  freedraw: 'draw',
  ellipse: 'circle',
  rectangle: 'crop_square',
  diamond: 'diamond',
  arrow: 'arrow_outward',
  line: 'horizontal_rule',
  text: 'title',
  eraser: 'ink_eraser',
};

/** Long enough not to fire on a press meant as an ordinary one, short enough
 *  that a reader who suspects there is more under the button finds out. */
const HOLD_MS = 350;

type Choose = (tool: BoxTool, locked: boolean) => void;

type ToolButtonProps = {
  icon: MaterialSymbol;
  label: string;
  /** Left out by the note button, which does a thing rather than being a
   *  state: `aria-pressed="false"` would promise a toggle that is not there. */
  on?: boolean;
  /** Marks the corner, so a button with more under it looks like one. */
  grouped?: boolean;
  ref?: Ref<HTMLButtonElement>;
} & Omit<ComponentPropsWithoutRef<'button'>, 'className'>;

const ToolButton = ({
  icon,
  label,
  on,
  grouped = false,
  ref,
  ...rest
}: ToolButtonProps) => (
  <Tooltip label={label}>
    <button
      {...rest}
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={on}
      className={cx(
        styles.tool,
        on && styles.toolOn,
        grouped && styles.grouped,
      )}
    >
      <Icon icon={icon} size={18} />
    </button>
  </Tooltip>
);

/** One button standing for several tools: a press picks the member it is
 *  showing, a hold opens the rest. Which member it shows is the last one
 *  picked, remembered across sessions by `pen.ts`. */
const ToolGroup = ({
  members,
  current,
  live,
  choose,
}: {
  members: readonly BoxTool[];
  current: BoxTool;
  live: Live;
  choose: Choose;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const held = useRef<number | null>(null);

  const cancel = () => {
    if (held.current != null) window.clearTimeout(held.current);
    held.current = null;
  };
  useEffect(() => cancel, []);

  return (
    <Popover
      opened={open}
      onChange={setOpen}
      position="bottom-start"
      shadow="md"
      withinPortal
    >
      <Popover.Target>
        <ToolButton
          grouped
          icon={ICONS[current]}
          on={live.tool === current}
          label={t(`spots.penTool.${current}`)}
          // Set here rather than left to `Popover.Target`, which hands its
          // props to the `Tooltip` in between and gets no further.
          aria-haspopup="true"
          aria-expanded={open}
          onPointerDown={() => {
            held.current = window.setTimeout(() => {
              held.current = null;
              setOpen(true);
            }, HOLD_MS);
          }}
          onPointerUp={() => {
            // Still counting: released before the flyout opened, so an
            // ordinary press.
            const press = held.current != null;
            cancel();
            if (press) {
              setOpen(false);
              choose(current, live.locked);
            }
          }}
          onPointerCancel={cancel}
          onPointerLeave={cancel}
        />
      </Popover.Target>
      {/* Portalled, so it is outside the strip and needs the same guard against
          taking focus off Excalidraw's container. */}
      <Popover.Dropdown
        className={styles.flyout}
        onPointerDown={(event) => event.preventDefault()}
      >
        {members.map((member) => (
          <ToolButton
            key={member}
            icon={ICONS[member]}
            on={live.tool === member}
            label={t(`spots.penTool.${member}`)}
            onClick={() => {
              setOpen(false);
              choose(member, live.locked);
            }}
          />
        ))}
      </Popover.Dropdown>
    </Popover>
  );
};

export const SketchTools = ({
  live,
  pen,
  choose,
  onStyle,
  onNote,
}: {
  live: Live;
  pen: Pen;
  choose: Choose;
  onStyle: (next: SketchStyle) => void;
  onNote: () => void;
}) => {
  const { t } = useTranslation();

  const set = (patch: Partial<SketchStyle>) =>
    onStyle({
      colour: live.colour,
      width: live.width,
      filled: live.filled,
      ...patch,
    });

  const plain = (tool: BoxTool) => (
    <ToolButton
      icon={ICONS[tool]}
      on={live.tool === tool}
      label={t(`spots.penTool.${tool}`)}
      onClick={() => choose(tool, live.locked)}
    />
  );

  const fillLabel = t(live.filled ? 'spots.penFillOff' : 'spots.penFillOn');
  const lockLabel = t(live.locked ? 'spots.penUnlock' : 'spots.penLock');

  return (
    <div
      className={styles.strip}
      role="toolbar"
      aria-label={t('spots.penTools')}
      // `handleKeyboardGlobally` is off, so Excalidraw's shortcuts are bound to
      // its own container: a press that moved focus out here would leave the
      // reader without them until they clicked back onto the canvas. Tabbing
      // in still works, and the click still fires.
      onPointerDown={(event) => event.preventDefault()}
    >
      <div className={styles.row}>
        <ControlUnit>
          {plain('hand')}
          {plain('selection')}
          {plain('freedraw')}
          <ToolGroup
            members={SHAPE_TOOLS}
            current={pen.shape}
            live={live}
            choose={choose}
          />
          <ToolGroup
            members={LINEAR_TOOLS}
            current={pen.linear}
            live={live}
            choose={choose}
          />
          {plain('text')}
          <ToolButton
            icon="sticky_note_2"
            label={t('spots.penNote')}
            onClick={onNote}
          />
          {plain('eraser')}
        </ControlUnit>

        <span className={styles.rule} />

        <Tooltip label={lockLabel}>
          <ControlButton
            icon={live.locked ? 'lock' : 'lock_open'}
            on={live.locked}
            aria-label={lockLabel}
            onClick={() => choose(live.tool ?? 'selection', !live.locked)}
          />
        </Tooltip>
      </div>

      <div className={styles.row}>
        <div className={styles.swatches}>
          {PEN_COLOURS.map((colour) => {
            const label = t(`spots.penColour.${colour.name}`);
            return (
              <Tooltip key={colour.value} label={label}>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={colour.value === live.colour}
                  className={cx(
                    styles.swatch,
                    colour.value === live.colour && styles.swatchOn,
                  )}
                  style={{ background: colour.value }}
                  onClick={() => set({ colour: colour.value })}
                />
              </Tooltip>
            );
          })}
        </div>

        <span className={styles.rule} />

        <ControlUnit>
          {PEN_WIDTHS.map((width) => {
            const label = t(`spots.penWidth.${width.name}`);
            return (
              <Tooltip key={width.value} label={label}>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={width.value === live.width}
                  className={cx(
                    styles.width,
                    width.value === live.width && styles.widthOn,
                  )}
                  onClick={() => set({ width: width.value })}
                >
                  {/* A 1 px bar on a button reads as a hairline crack, so the
                      bars are the widths plus one. */}
                  <span
                    className={styles.bar}
                    style={{ height: width.value + 1 }}
                  />
                </button>
              </Tooltip>
            );
          })}
        </ControlUnit>

        <span className={styles.rule} />

        <Tooltip label={fillLabel}>
          <ControlButton
            icon="texture"
            on={live.filled}
            disabled={!live.fillable}
            aria-label={fillLabel}
            onClick={() => set({ filled: !live.filled })}
          />
        </Tooltip>
      </div>
    </div>
  );
};
