// What Excalidraw's toolbar and properties island used to do, in the tools and
// the three properties the strip keeps. Neither has a prop behind it and
// neither exposes its actions, so reading is off `onChange`'s app state and
// writing is `setActiveTool` and `updateScene`.

import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  newElementWith,
  viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw';
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types';

import { LINEAR_TOOLS, SHAPE_TOOLS } from './pen';
import type { SceneElement } from './scene';

/** The strip's own set. Excalidraw's `ToolType` is not a package export, and
 *  the tools left out of this list — laser, frame, embeddable — have no use on
 *  a map and are off the strip. The hand is first because the map's own
 *  dragging is frozen for the session, so it is the only thing that moves the
 *  view. */
const BOX_TOOLS = [
  'hand',
  'selection',
  'freedraw',
  ...SHAPE_TOOLS,
  ...LINEAR_TOOLS,
  'text',
  'eraser',
] as const;

export type BoxTool = (typeof BOX_TOOLS)[number];

/** Excalidraw's own `hasBackground`, which the package does not export: the
 *  types a fill means anything on. */
export const fillable = (type: string) =>
  type === 'rectangle' ||
  type === 'diamond' ||
  type === 'ellipse' ||
  type === 'line' ||
  type === 'freedraw';

export type SketchStyle = {
  colour: string;
  width: number;
  /** Excalidraw keeps a background colour and a fill style separately; here a
   *  fill is on or off and takes the stroke's own colour, hatched so the
   *  ground being read still shows through (`SketchCanvas`). */
  filled: boolean;
};

/** Everything the strip draws itself from, lifted out of `onChange`. */
export type Live = SketchStyle & {
  /** null while Excalidraw is on a tool the strip does not show, which only a
   *  keyboard shortcut can reach. */
  tool: BoxTool | null;
  locked: boolean;
  /** Whether the fill button would do anything where the reader is. */
  fillable: boolean;
};

type LiveState = Pick<
  AppState,
  | 'activeTool'
  | 'currentItemBackgroundColor'
  | 'currentItemStrokeColor'
  | 'currentItemStrokeWidth'
  | 'selectedElementIds'
>;

/** Selected elements, plus text bound inside them — Excalidraw's own restyling
 *  carries a container's label along, and a label left behind in the old
 *  colour is the thing a reader would call a bug. Locked ones are left. */
const restyled = (
  appState: LiveState,
  elements: readonly SceneElement[],
): Set<string> => {
  const ids = new Set<string>();
  for (const element of elements) {
    if (element.isDeleted || element.locked) continue;
    if (!appState.selectedElementIds[element.id]) continue;
    ids.add(element.id);
    for (const bound of element.boundElements ?? []) {
      if (bound.type === 'text') ids.add(bound.id);
    }
  }
  return ids;
};

/** The selection's style where there is one, otherwise the pen's. The last
 *  selected element wins, as Excalidraw's island did. */
export const readLive = (
  appState: LiveState,
  elements: readonly SceneElement[],
): Live => {
  const selected = elements.filter(
    (element) => !element.isDeleted && appState.selectedElementIds[element.id],
  );
  // Indexed rather than `at(-1)`: the build targets ES2020.
  const last: SceneElement | undefined = selected[selected.length - 1];
  const background =
    last?.backgroundColor ?? appState.currentItemBackgroundColor;
  const tool = appState.activeTool.type;
  return {
    tool: (BOX_TOOLS as readonly string[]).includes(tool)
      ? (tool as BoxTool)
      : null,
    locked: appState.activeTool.locked,
    colour: last?.strokeColor ?? appState.currentItemStrokeColor,
    width: last?.strokeWidth ?? appState.currentItemStrokeWidth,
    filled: background !== 'transparent',
    fillable:
      selected.length > 0
        ? selected.some((element) => fillable(element.type))
        : fillable(tool),
  };
};

/** Sets the pen and restyles the selection, the two halves of what one press
 *  on Excalidraw's island did. */
export const applyStyle = (api: ExcalidrawImperativeAPI, next: SketchStyle) => {
  const appState = api.getAppState();
  const background = next.filled ? next.colour : 'transparent';
  // Including deleted: `updateScene` takes the array as the whole scene, and
  // dropping the tombstones would put the erased strokes beyond undo's reach.
  const elements = api.getSceneElementsIncludingDeleted();
  const targets = restyled(appState, elements);

  api.updateScene({
    appState: {
      currentItemStrokeColor: next.colour,
      currentItemStrokeWidth: next.width,
      currentItemBackgroundColor: background,
    },
    elements:
      targets.size === 0
        ? undefined
        : elements.map((element) =>
            targets.has(element.id)
              ? newElementWith(element, {
                  strokeColor: next.colour,
                  strokeWidth: next.width,
                  ...(fillable(element.type)
                    ? { backgroundColor: background }
                    : {}),
                })
              : element,
          ),
    // One undo step of its own; left to Excalidraw the restyle would ride on
    // whatever the reader drew next.
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

/** A note is a rectangle with text bound inside it. Excalidraw has no tool
 *  that makes one — natively it is draw a box, then press Enter — so the strip
 *  builds the pair and hands it over. */
const NOTE = {
  widthPx: 170,
  heightPx: 100,
  /** Excalidraw's own yellow, filled solid rather than with the hatch every
   *  other fill here uses: a note is written over the ground, not traced off
   *  it, and paper it cannot be read through is the point. */
  background: '#ffec99',
  /** Also the label's colour — `bindTextToContainer` falls back to the
   *  container's stroke — which is what keeps the writing off the pen's own. */
  stroke: '#1e1e1e',
} as const;

/** Notes are dropped in the middle of the view, so without a shift the second
 *  one would land exactly on the first. */
const CASCADE_PX = 22;
const CASCADE_STEPS = 6;

export const addNote = (
  api: ExcalidrawImperativeAPI,
  host: HTMLElement,
  text: string,
  nth: number,
) => {
  const appState = api.getAppState();
  const middle = viewportCoordsToSceneCoords(
    {
      clientX: appState.offsetLeft + appState.width / 2,
      clientY: appState.offsetTop + appState.height / 2,
    },
    appState,
  );
  const shift = (nth % CASCADE_STEPS) * CASCADE_PX;
  // Two elements back: the rectangle and the text bound to it.
  const made = convertToExcalidrawElements([
    {
      type: 'rectangle',
      x: middle.x - NOTE.widthPx / 2 + shift,
      y: middle.y - NOTE.heightPx / 2 + shift,
      width: NOTE.widthPx,
      height: NOTE.heightPx,
      backgroundColor: NOTE.background,
      fillStyle: 'solid',
      strokeColor: NOTE.stroke,
      strokeWidth: 1,
      label: { text },
    },
  ]);
  const note = made[0];
  if (!note) return;

  // Selection, so the note can be dragged off the middle straight away; a
  // press on the note button while the pen was down would otherwise leave the
  // reader drawing.
  api.setActiveTool({ type: 'selection' });
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...made],
    appState: { selectedElementIds: { [note.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  // Enter on a selected container is how Excalidraw opens its label for
  // editing and there is no API for it, so the press is synthesised — the same
  // trick `SketchCanvas` plays on the wheel. The editor selects the text it
  // finds, so the placeholder is typed over rather than edited around. After a
  // frame: the selection above goes through `setState` and the handler reads
  // it back.
  const container = host.querySelector('.excalidraw-container');
  requestAnimationFrame(() => {
    container?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
  });
};
