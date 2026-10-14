import './excalidrawAssets';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  NormalizedZoomValue,
} from '@excalidraw/excalidraw/types';
import { useAtomValue, useStore } from 'jotai';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { mapAtom } from '../map/atoms';
import { spotSketchAtom } from '../spots/atoms';
import { rememberedPen, rememberStroke, rememberTool, type Pen } from './pen';
import styles from './SketchCanvas.module.css';
import { storableScene, type SceneElement } from './scene';
import {
  initialSceneView,
  moveMapToScene,
  setLiveScene,
  type SketchSession,
} from './session';
import { SketchTools } from './SketchTools';
import {
  addNote,
  applyStyle,
  fillable,
  readLive,
  type BoxTool,
  type Live,
} from './toolbox';

const LANG_CODES = { nb: 'nb-NO', nn: 'nn-NO', en: 'en' } as const;

const excalidrawLang = (language: string) =>
  LANG_CODES[language.slice(0, 2) as keyof typeof LANG_CODES] ?? 'en';

const SCENE_SETTLE_MS = 150;

const PX_PER_LINE = 16;

const pixelDeltaY = (event: WheelEvent) =>
  event.deltaMode === 0
    ? event.deltaY
    : event.deltaY * (event.deltaMode === 1 ? PX_PER_LINE : window.innerHeight);

const zoomOnWheel = (event: WheelEvent) => {
  if (!event.isTrusted || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }
  if (!(event.target instanceof HTMLCanvasElement)) return;
  event.preventDefault();
  event.stopPropagation();
  event.target.dispatchEvent(
    new WheelEvent('wheel', {
      deltaY: pixelDeltaY(event),
      deltaMode: 0,
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
};

type Offset = { x: number; y: number; zoom: number };

const OPENING_TOOL: BoxTool = 'hand';

type Store = ReturnType<typeof useStore>;

const keepScene = (
  store: Store,
  frame: SketchSession['frame'],
  elements: readonly SceneElement[],
) => {
  const kept = storableScene(elements);
  store.set(spotSketchAtom, kept.length > 0 ? { frame, elements: kept } : null);
};

const buildInitialData = (
  offset: Offset,
  elements: readonly SceneElement[],
  pen: Pen,
): ExcalidrawInitialDataState => ({
  elements,
  appState: {
    viewBackgroundColor: 'transparent',
    theme: 'light',
    currentItemStrokeColor: pen.colour,
    currentItemStrokeWidth: pen.width,
    currentItemBackgroundColor: 'transparent',
    currentItemFillStyle: 'hachure',
    zoom: { value: offset.zoom as NormalizedZoomValue },
    scrollX: offset.x,
    scrollY: offset.y,
  },
  scrollToContent: false,
});

export const SketchCanvas = ({ session }: { session: SketchSession }) => {
  const { t, i18n } = useTranslation();
  const map = useAtomValue(mapAtom);
  const store = useStore();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<Offset | null>(null);
  const lastView = useRef('');
  const settle = useRef<number | null>(null);

  const [opening] = useState(() => session.opening);

  const [pen, setPen] = useState(rememberedPen);
  const [live, setLive] = useState<Live>(() => ({
    tool: OPENING_TOOL,
    locked: pen.locked,
    colour: pen.colour,
    width: pen.width,
    filled: false,
    fillable: fillable(OPENING_TOOL),
  }));
  const lastLive = useRef('');
  const notes = useRef(0);

  const choose = useCallback((tool: BoxTool, locked: boolean) => {
    apiRef.current?.setActiveTool({ type: tool, locked });
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const here = host.getBoundingClientRect();
    const view = initialSceneView(here);
    setOffset({ x: view.scrollX, y: view.scrollY, zoom: view.zoom });
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.addEventListener('wheel', zoomOnWheel, {
      capture: true,
      passive: false,
    });
    return () =>
      host.removeEventListener('wheel', zoomOnWheel, { capture: true });
  }, []);

  const registerApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;
      setLiveScene({
        frame: session.frame,
        read: () => api.getSceneElementsIncludingDeleted(),
      });
      api.setActiveTool({ type: OPENING_TOOL, locked: rememberedPen().locked });
    },
    [session.frame],
  );

  useEffect(
    () => () => {
      if (settle.current != null) window.clearTimeout(settle.current);
      setLiveScene(null);
    },
    [],
  );

  return (
    <div className={styles.surface} ref={hostRef}>
      {offset && (
        <Excalidraw
          initialData={buildInitialData(offset, opening, pen)}
          excalidrawAPI={registerApi}
          langCode={excalidrawLang(i18n.language)}
          onChange={(elements, appState) => {
            const view = {
              scrollX: appState.scrollX,
              scrollY: appState.scrollY,
              zoom: appState.zoom.value,
              offsetLeft: appState.offsetLeft,
              offsetTop: appState.offsetTop,
            };
            const key = Object.values(view).join();
            if (key !== lastView.current) {
              lastView.current = key;
              moveMapToScene(map, view);
            }
            rememberTool(appState.activeTool.type, appState.activeTool.locked);
            rememberStroke(
              appState.currentItemStrokeColor,
              appState.currentItemStrokeWidth,
            );
            setPen(rememberedPen());

            const next = readLive(appState, elements);
            const liveKey = Object.values(next).join();
            if (liveKey !== lastLive.current) {
              lastLive.current = liveKey;
              setLive(next);
            }

            if (settle.current != null) window.clearTimeout(settle.current);
            settle.current = window.setTimeout(() => {
              settle.current = null;
              keepScene(store, session.frame, elements);
            }, SCENE_SETTLE_MS);
          }}
          handleKeyboardGlobally={false}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: false,
              clearCanvas: false,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              saveAsImage: false,
              toggleTheme: false,
            },
            tools: { image: false },
          }}
        />
      )}
      {offset && (
        <SketchTools
          live={live}
          pen={pen}
          choose={choose}
          onStyle={(next) => {
            const api = apiRef.current;
            if (api) applyStyle(api, next);
          }}
          onNote={() => {
            const api = apiRef.current;
            const host = hostRef.current;
            if (api && host) {
              addNote(api, host, t('spots.penNoteText'), notes.current++);
            }
          }}
        />
      )}
    </div>
  );
};
