// First, and not merged into the import below: it sets the global Excalidraw
// reads to find its fonts, and ES modules evaluate in source order.
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

// Excalidraw over the frozen map (`session.ts`), transparent, with nothing in
// the scene but the reader's own strokes — so nothing has to be stripped out of
// it before it is stored. Scene units are the CSS pixels of the frozen
// viewport, scrolled by this surface's inset inside the map. The canvas can
// still be panned and zoomed, so the map is slaved to it by `slaveMapToScene`
// rather than the other way round.

// Excalidraw's language codes are regioned and ours are not, hence a map rather
// than a pass-through; anything unrecognised falls to English, as `i18n.ts` does.
const LANG_CODES = { nb: 'nb-NO', nn: 'nn-NO', en: 'en' } as const;

const excalidrawLang = (language: string) =>
  LANG_CODES[language.slice(0, 2) as keyof typeof LANG_CODES] ?? 'en';

// How long the drawing may lag behind the pen. `onChange` fires on every
// pointer sample; `Lagre` does not wait for the settle anyway (`sketchNow`).
const SCENE_SETTLE_MS = 150;

// The wheel zooms here as it does over the map, which Excalidraw has no prop
// for: a plain notch over the canvas is caught in the capture phase and
// re-dispatched at the same target with `ctrlKey` set, the same event a
// trackpad pinch sends, so the zoom stays anchored, stepped and clamped as
// Excalidraw's own. Ctrl/Cmd+wheel, Shift+wheel and anything not over the
// canvas are left alone.
const PX_PER_LINE = 16;

// Excalidraw reads `deltaY` as pixels: Firefox reports plain wheels in lines
// (deltaY 3), which would be a 3% zoom step where Chrome gets 10%.
const pixelDeltaY = (event: WheelEvent) =>
  event.deltaMode === 0
    ? event.deltaY
    : event.deltaY * (event.deltaMode === 1 ? PX_PER_LINE : window.innerHeight);

const zoomOnWheel = (event: WheelEvent) => {
  // `isTrusted` is the recursion guard: a dispatched event is never trusted, so
  // the copy below passes straight through to Excalidraw's own handler.
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

const buildInitialData = (
  offset: Offset,
  elements: readonly SceneElement[],
): ExcalidrawInitialDataState => ({
  elements,
  appState: {
    // The map is the background; anything opaque here would hide it.
    viewBackgroundColor: 'transparent',
    // Light, against the app's dark chrome, and deliberately: Excalidraw's dark
    // theme is a filter over the canvas, so the strokes would be drawn in one
    // set of colours and kept in another. The chrome around it is restyled in
    // the CSS module instead.
    theme: 'light',
    // The app's orange rather than Excalidraw's near-black, every time the
    // canvas opens: what is drawn here is a reading of the relief underneath,
    // and grey-on-grey is the one thing it must not be (`pen.ts`). Existing
    // strokes keep whatever they were drawn in — this is the colour of the
    // next one.
    currentItemStrokeColor: PEN_STROKE_COLOUR,
    // Whatever puts the scene over the ground it belongs on with the map
    // untransformed (`initialSceneView`).
    zoom: { value: offset.zoom as NormalizedZoomValue },
    scrollX: offset.x,
    scrollY: offset.y,
  },
  scrollToContent: false,
});

export const SketchCanvas = ({ session }: { session: SketchSession }) => {
  const { i18n } = useTranslation();
  const map = useAtomValue(mapAtom);
  // The store rather than a setter: the unmount flush below has to read the
  // draft as well as write the drawing, and reading it with a hook here would
  // rebuild the canvas every time the pin moved.
  const store = useStore();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<Offset | null>(null);
  // The last view pushed at the map, so the transform is only rewritten when it
  // changed: `onChange` fires on every pointer sample, almost none of which
  // move the canvas.
  const lastView = useRef('');
  const settle = useRef<number | null>(null);

  // Read once: `spotSketchAtom` is written from here on every change, and
  // feeding that back into `initialData` would rebuild the scene mid-stroke.
  const [opening] = useState(() => session.opening);

  // Scene (0, 0) is the top-left of the frozen viewport, but this surface only
  // occupies the map's rectangle, not the window's, so the scene is scrolled by
  // however far it sits inside the page. Measured, because the band's height is
  // its content's; layout effect, so the first paint is already registered.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const here = host.getBoundingClientRect();
    const view = initialSceneView(here);
    setOffset({ x: view.scrollX, y: view.scrollY, zoom: view.zoom });
  }, []);

  // On this surface rather than the canvas, which is Excalidraw's and is
  // replaced under us; capture, so the notch is rewritten before Excalidraw's
  // own bubble-phase listener inside here sees it.
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
  // `Lagre` does not keep a drawing a settle behind the pen.
  const registerApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;
      setLiveScene({
        frame: session.frame,
        read: () => api.getSceneElementsIncludingDeleted(),
      });
      // The tool the reader last drew with, put back in their hand. Through the
      // API rather than `initialData`, which restores an active tool only for
      // the values its own restorer allows and says nothing about which those
      // are; this is the documented way to arm one.
      const pen = rememberedPen();
      if (pen) api.setActiveTool({ type: pen.tool, locked: pen.locked });
    },
    [session.frame],
  );

  // Putting the pen down ends the canvas with up to a settle unwritten, so the
  // atom is flushed from the scene itself rather than from the pending timer.
  // Only while the draft is still open: closing one clears all three of its
  // atoms and then unmounts this, and a flush after that would leave a drawing
  // behind for a draft that no longer exists. The reader is handed back either
  // way — it must not be a door into a canvas gone.
  useEffect(
    () => () => {
      if (settle.current != null) window.clearTimeout(settle.current);
      const api = apiRef.current;
      if (api && store.get(spotDraftAtom)) {
        const kept = storableScene(api.getSceneElementsIncludingDeleted());
        store.set(
          spotSketchAtom,
          kept.length > 0 ? { frame: session.frame, elements: kept } : null,
        );
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
            // Which tool is in hand, for the next canvas. Ignores the automatic
            // fall back to selection after a shape is finished, and writes only
            // when the answer changed — this fires on every pointer sample.
            rememberPen(appState.activeTool.type, appState.activeTool.locked);

            if (settle.current != null) window.clearTimeout(settle.current);
            settle.current = window.setTimeout(() => {
              settle.current = null;
              const kept = storableScene(elements);
              store.set(
                spotSketchAtom,
                kept.length > 0
                  ? { frame: session.frame, elements: kept }
                  : null,
              );
            }, SCENE_SETTLE_MS);
          }}
          // Excalidraw's shortcuts are single letters and digits, and the
          // draft's name field is a box away: listening on the document would
          // make typing a name pick tools too. The app's own keyboard map
          // stands down from the other side (map/useBackgroundCyclingKeys.ts).
          handleKeyboardGlobally={false}
          UIOptions={{
            canvasActions: {
              // All of these act on Excalidraw's document as a file; here it is
              // one field of a spot, saved with the rest of it.
              changeViewBackgroundColor: false,
              clearCanvas: false,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              saveAsImage: false,
              toggleTheme: false,
            },
            // The rest of the toolbox is Excalidraw's default for now. Not the
            // image tool: pictures are out of scope on this branch, and a PNG
            // dropped in here would be stored inside the drawing where nothing
            // can see it.
            tools: { image: false },
          }}
        />
      )}
    </div>
  );
};
