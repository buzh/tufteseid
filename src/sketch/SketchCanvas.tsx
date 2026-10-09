// Must stay above the import below: it sets the global Excalidraw reads to find
// its fonts, and ES modules evaluate in source order.
import './excalidrawAssets';
import { CaptureUpdateAction, Excalidraw } from '@excalidraw/excalidraw';
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
  holdSceneOnMap,
  initialSceneView,
  setLiveScene,
  slaveMapToScene,
  type SceneView,
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
// event a trackpad pinch sends — keeping its own anchoring, stepping and
// clamping. Ctrl/Cmd+wheel, Shift+wheel and anything off the canvas are left
// alone.
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

// What every canvas opens on, the remembered pen notwithstanding: the map's own
// panning is frozen for the session, so the hand stands in for it.
const OPENING_TOOL: BoxTool = 'hand';

// Excalidraw has no prop for a zoom floor or a scroll extent, so a frame that
// takes the scene off the map (`holdSceneOnMap`) is put back.
const holdView = (api: ExcalidrawImperativeAPI | null, view: SceneView) =>
  api?.updateScene({
    appState: {
      scrollX: view.scrollX,
      scrollY: view.scrollY,
      zoom: { value: view.zoom as NormalizedZoomValue },
    },
    // Not an edit: undo must not step back through a view being put back.
    captureUpdate: CaptureUpdateAction.NEVER,
  });

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
    // Light against the app's dark chrome: Excalidraw's dark theme is a filter
    // over the canvas, so strokes would be drawn in one set of colours and kept
    // in another. The chrome is restyled in the CSS module instead.
    theme: 'light',
    // The *next* stroke; existing ones keep what they were drawn with. Only
    // the three the strip offers — roughness and rounded edges are left
    // Excalidraw's own, which is what makes a traced line look drawn.
    currentItemStrokeColor: pen.colour,
    currentItemStrokeWidth: pen.width,
    currentItemBackgroundColor: 'transparent',
    // Hatched rather than Excalidraw's solid: a filled shape sits over the
    // ground being read, and a solid one hides the evidence.
    currentItemFillStyle: 'hachure',
    // Puts the scene over its ground with the map untransformed
    // (`initialSceneView`).
    zoom: { value: offset.zoom as NormalizedZoomValue },
    scrollX: offset.x,
    scrollY: offset.y,
  },
  scrollToContent: false,
});

export const SketchCanvas = ({ session }: { session: SketchSession }) => {
  const { t, i18n } = useTranslation();
  const map = useAtomValue(mapAtom);
  // The store rather than a setter: a hook here would rebuild the canvas every
  // time the pin moved.
  const store = useStore();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<Offset | null>(null);
  // The floor the scene may not be taken out past. Read off the first frame
  // rather than `offset`, because Excalidraw clamps a zoom it is handed to its
  // own 10%…3000%, and a floor it can never reach would put every frame back.
  const floorZoom = useRef<number | null>(null);
  // `onChange` fires on every pointer sample, so the transform is rewritten
  // only when the view actually moved.
  const lastView = useRef('');
  const settle = useRef<number | null>(null);

  // Read once: `spotSketchAtom` is written from here on every change, and
  // feeding that back into `initialData` would rebuild the scene mid-stroke.
  const [opening] = useState(() => session.opening);

  // Two records behind the strip, both refreshed off `onChange`: `pen` is what
  // the reader last reached for, `live` is Excalidraw's own state.
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
  // Only ever counts up, so notes dropped in one session cascade rather than
  // stacking on the middle of the view.
  const notes = useRef(0);

  // `pen` is not set here: `rememberTool` runs off `onChange`, so reading the
  // record back on this line would still answer with the tool before this one.
  const choose = useCallback((tool: BoxTool, locked: boolean) => {
    apiRef.current?.setActiveTool({ type: tool, locked });
  }, []);

  // Scene (0, 0) is the top-left of the frozen viewport but this surface covers
  // only the map's rectangle, so the scene is scrolled by its inset. A layout
  // effect, so the first paint has it.
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
      api.setActiveTool({ type: OPENING_TOOL, locked: rememberedPen().locked });
    },
    [session.frame],
  );

  // Nothing is read off the scene on the way out: Excalidraw is being torn down
  // by now and answers with an empty one, which would go over the atom as a
  // drawing with no strokes. Whoever ends the session takes it first, through
  // `sketchNow` while the canvas is still up.
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
            const floor = floorZoom.current ?? view.zoom;
            floorZoom.current = floor;
            const key = Object.values(view).join();
            if (key !== lastView.current) {
              lastView.current = key;
              const held = holdSceneOnMap(map, view, floor);
              if (held) holdView(apiRef.current, held);
              else slaveMapToScene(map, view);
            }
            rememberTool(appState.activeTool.type, appState.activeTool.locked);
            rememberStroke(
              appState.currentItemStrokeColor,
              appState.currentItemStrokeWidth,
            );
            // Same object back unless one of the two above wrote, so the
            // grouped buttons re-render only when their member changed.
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
          // Excalidraw's shortcuts are single letters and digits, and the
          // draft's name field is a box away: listening on the document would
          // make typing a name pick tools too.
          handleKeyboardGlobally={false}
          UIOptions={{
            // All of these act on the scene as a file; here it is one field of
            // a spot, saved with the rest of it.
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
