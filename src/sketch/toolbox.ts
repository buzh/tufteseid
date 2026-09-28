// What Excalidraw's toolbar and properties island used to do, in the tools and
// the three properties the strip keeps. Neither has a prop behind it and
// neither exposes its actions, so reading is off `onChange`'s app state and
// writing is `setActiveTool` and `updateScene`.

import { CaptureUpdateAction, newElementWith } from '@excalidraw/excalidraw';
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types';

import { LINEAR_TOOLS, SHAPE_TOOLS } from './pen';
import type { SceneElement } from './scene';

/** The strip's own set. Excalidraw's `ToolType` is not a package export, and
 *  the tools left out of this list — hand, laser, frame, embeddable — have no
 *  use on a map and are off the strip. */
const BOX_TOOLS = [
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
