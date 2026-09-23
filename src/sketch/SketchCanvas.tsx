// Must stay above the import below: it sets the global Excalidraw reads to find
// its fonts, and ES modules evaluate in source order.
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
import { spotDraftAtom, spotSketchAtom } from '../spots/atoms';
import { PEN_STROKE_COLOUR, rememberedPen, rememberPen } from './pen';
import styles from './SketchCanvas.module.css';
import { storableScene, type SceneElement } from './scene';
import {
  initialSceneView,
  setLiveScene,
  slaveMapToScene,
  type SketchSession,
} from './session';

// Excalidraw's language codes are regioned and ours are not; anything
// unrecognised falls to English, as `i18n.ts` does.
const LANG_CODES = { nb: 'nb-NO', nn: 'nn-NO', en: 'en' } as const;

const excalidrawLang = (language: string) =>
  LANG_CODES[language.slice(0, 2) as keyof typeof LANG_CODES] ?? 'en';

// How long the drawing may lag behind the pen. `onChange` fires on every
// pointer sample; saving does not wait for the settle (`sketchNow`).
const SCENE_SETTLE_MS = 150;

const PX_PER_LINE = 16;

// Excalidraw reads `deltaY` as pixels: Firefox reports plain wheels in lines
// (deltaY 3), which would be a 3% zoom step where Chrome gets 10%.
const pixelDeltaY = (event: WheelEvent) =>
  event.deltaMode === 0
    ? event.deltaY
    : event.deltaY * (event.deltaMode === 1 ? PX_PER_LINE : window.innerHeight);

// Excalidraw has no prop for a plain wheel zoom, so one is caught in the
// capture phase and re-dispatched at the same target with `ctrlKey` set — the
// event a trackpad pinch sends — keeping Excalidraw's own anchoring, stepping
// and clamping. Ctrl/Cmd+wheel, Shift+wheel and anything off the canvas are
// left alone.
const zoomOnWheel = (event: WheelEvent) => {
  // `isTrusted` is the recursion guard: a dispatched event is never trusted, so
  // the copy below passes through to Excalidraw's own handler.
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
): ExcalidrawInitialDataState => ({
  elements,
  appState: {
    viewBackgroundColor: 'transparent',
    // Light against the app's dark chrome: Excalidraw's dark theme is a filter
    // over the canvas, so strokes would be drawn in one set of colours and kept
    // in another. The chrome is restyled in the CSS module instead.
    theme: 'light',
    // The colour of the *next* stroke; existing ones keep theirs.
    currentItemStrokeColor: PEN_STROKE_COLOUR,
    // Puts the scene over its ground with the map untransformed
    // (`initialSceneView`).
    zoom: { value: offset.zoom as NormalizedZoomValue },
    scrollX: offset.x,
    scrollY: offset.y,
  },
  scrollToContent: false,
});

export const SketchCanvas = ({ session }: { session: SketchSession }) => {
  const { i18n } = useTranslation();
  const map = useAtomValue(mapAtom);
  // The store rather than a setter: a hook here would rebuild the canvas every
  // time the pin moved.
  const store = useStore();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<Offset | null>(null);
  // `onChange` fires on every pointer sample, so the transform is rewritten
  // only when the view actually moved.
  const lastView = useRef('');
  const settle = useRef<number | null>(null);

  // Read once: `spotSketchAtom` is written from here on every change, and
  // feeding that back into `initialData` would rebuild the scene mid-stroke.
  const [opening] = useState(() => session.opening);

  // Scene (0, 0) is the top-left of the frozen viewport but this surface covers
  // only the map's rectangle, so the scene is scrolled by its inset. A layout
  // effect, so the first paint already has it.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const here = host.getBoundingClientRect();
    const view = initialSceneView(here);
    setOffset({ x: view.scrollX, y: view.scrollY, zoom: view.zoom });
  }, []);

  // On this surface, not the canvas Excalidraw replaces under us, and in the
  // capture phase so the notch is rewritten before Excalidraw's own listener
  // sees it.
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

  // The live scene, lent out for as long as the canvas is up (`sketchNow`), so
  // saving does not keep a drawing a settle behind the pen.
  const registerApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;
      setLiveScene({
        frame: session.frame,
        read: () => api.getSceneElementsIncludingDeleted(),
      });
      // Through the API rather than `initialData`, which restores an active
      // tool only for the values its own restorer allows.
      const pen = rememberedPen();
      if (pen) api.setActiveTool({ type: pen.tool, locked: pen.locked });
    },
    [session.frame],
  );

  // Up to a settle can be unwritten at unmount, so the atom is flushed from the
  // scene itself — but only while the draft is still open, since closing one
  // clears its atoms and then unmounts this.
  useEffect(
    () => () => {
      if (settle.current != null) window.clearTimeout(settle.current);
      const api = apiRef.current;
      if (api && store.get(spotDraftAtom)) {
        keepScene(store, session.frame, api.getSceneElementsIncludingDeleted());
      }
      setLiveScene(null);
    },
    [session.frame, store],
  );

  return (
    <div className={styles.surface} ref={hostRef}>
      {offset && (
        <Excalidraw
          initialData={buildInitialData(offset, opening)}
          excalidrawAPI={registerApi}
          langCode={excalidrawLang(i18n.language)}
          onChange={(elements, appState) => {
            // Excalidraw's own offsets, not the measured ones above: it
            // re-reads them on resize, so the map follows a band row appearing
            // mid-session without anything here observing the DOM.
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
              slaveMapToScene(map, view);
            }
            rememberPen(appState.activeTool.type, appState.activeTool.locked);

            if (settle.current != null) window.clearTimeout(settle.current);
            settle.current = window.setTimeout(() => {
              settle.current = null;
              keepScene(store, session.frame, elements);
            }, SCENE_SETTLE_MS);
          }}
          // Excalidraw's shortcuts are single letters and digits, and the
          // draft's name field is a box away: listening on the document would
          // make typing a name pick tools too.
          handleKeyboardGlobally={false}
          UIOptions={{
            // All of these act on Excalidraw's document as a file; here it is
            // one field of a spot, saved with the rest of it.
            canvasActions: {
              changeViewBackgroundColor: false,
              clearCanvas: false,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              saveAsImage: false,
              toggleTheme: false,
            },
            // No image tool: a PNG dropped in here would be stored inside the
            // drawing, against the 5 MB `sketch` cap, where nothing can see it.
            tools: { image: false },
          }}
        />
      )}
    </div>
  );
};
