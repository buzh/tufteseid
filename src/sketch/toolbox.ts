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

export const fillable = (type: string) =>
  type === 'rectangle' ||
  type === 'diamond' ||
  type === 'ellipse' ||
  type === 'line' ||
  type === 'freedraw';

export type SketchStyle = {
  colour: string;
  width: number;
  filled: boolean;
};

export type Live = SketchStyle & {
  tool: BoxTool | null;
  locked: boolean;
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

export const readLive = (
  appState: LiveState,
  elements: readonly SceneElement[],
): Live => {
  const selected = elements.filter(
    (element) => !element.isDeleted && appState.selectedElementIds[element.id],
  );
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

export const applyStyle = (api: ExcalidrawImperativeAPI, next: SketchStyle) => {
  const appState = api.getAppState();
  const background = next.filled ? next.colour : 'transparent';
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
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

const NOTE = {
  widthPx: 170,
  heightPx: 100,
  background: '#ffec99',
  stroke: '#1e1e1e',
} as const;

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

  api.setActiveTool({ type: 'selection' });
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...made],
    appState: { selectedElementIds: { [note.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  const container = host.querySelector('.excalidraw-container');
  requestAnimationFrame(() => {
    container?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
  });
};
