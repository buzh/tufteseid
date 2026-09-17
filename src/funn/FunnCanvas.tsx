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
import { useAtomValue, useSetAtom } from 'jotai';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { mapAtom } from '../map/atoms';
import styles from './FunnCanvas.module.css';
import type { SceneElement } from './scene';
import {
  funnSceneAtom,
  funnSessionAtom,
  initialSceneView,
  setLiveSceneReader,
  slaveMapToScene,
} from './session';

// Excalidraw over the frozen map (`session.ts`), transparent, with nothing in
// the scene but the user's own strokes — so nothing has to be stripped out of
// it before it is stored. Scene units are the CSS pixels of the frozen
// viewport, scrolled by this surface's inset inside the map. The canvas can
// still be panned and zoomed, so the map is slaved to it by `slaveMapToScene`
// rather than the other way round. The draw mode is deliberately invisible
// here: funn and sketch are the same surface with the same tools, and only the
// end of the session reads differently. docs/ui-architecture.md, "Drawing".

// Excalidraw's language codes are regioned and ours are not, hence a map rather
// than a pass-through; anything unrecognised falls to English, as `i18n.ts` does.
const LANG_CODES = { nb: 'nb-NO', nn: 'nn-NO', en: 'en' } as const;

const excalidrawLang = (language: string) =>
  LANG_CODES[language.slice(0, 2) as keyof typeof LANG_CODES] ?? 'en';

// How long the scene may lag behind the pen. `onChange` fires on every pointer
// sample, and the autosave settles for 700 ms on top of this anyway.
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
    theme: 'light',
    // Whatever puts the scene over the ground it belongs on with the map
    // untransformed (`initialSceneView`).
    zoom: { value: offset.zoom as NormalizedZoomValue },
    scrollX: offset.x,
    scrollY: offset.y,
  },
  scrollToContent: false,
});

export const FunnCanvas = () => {
  const { i18n } = useTranslation();
  const map = useAtomValue(mapAtom);
  const session = useAtomValue(funnSessionAtom);
  const setScene = useSetAtom(funnSceneAtom);
  const hostRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<Offset | null>(null);
  // The last view pushed at the map, so the transform is only rewritten when it
  // changed: `onChange` fires on every pointer sample, almost none of which
  // move the canvas.
  const lastView = useRef('');
  const settle = useRef<number | null>(null);

  // Read once: `funnSceneAtom` is written from here on every change, and
  // feeding that back into `initialData` would rebuild the scene mid-stroke.
  // Off `session.opening` rather than `session.resume`, which a geometry seeded
  // by `Rediger tegningen` does not have.
  const [opening] = useState<readonly SceneElement[]>(
    () => session?.opening ?? [],
  );

  // Scene (0, 0) is the top-left of the frozen viewport, but this surface only
  // occupies the strip the chrome leaves, so the scene is scrolled by however
  // far it sits inside the map. Measured, because the ribbon's height is its
  // content's; layout effect, so the first paint is already registered.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const here = host.getBoundingClientRect();
    const view = initialSceneView(here);
    setOffset({ x: view.scrollX, y: view.scrollY, zoom: view.zoom });
  }, []);

  useEffect(
    () => () => {
      if (settle.current != null) window.clearTimeout(settle.current);
    },
    [],
  );

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

  // The live scene, lent out for as long as the surface is up (`sceneNow`), so
  // the verbs that keep a drawing do not read one a settle behind the pen.
  // Handed back on unmount: a reader must not be a door into a canvas gone.
  const registerApi = useCallback((api: ExcalidrawImperativeAPI) => {
    setLiveSceneReader(() => api.getSceneElementsIncludingDeleted());
  }, []);
  useEffect(() => () => setLiveSceneReader(null), []);

  return (
    <div className={styles.surface} ref={hostRef}>
      {offset && (
        <Excalidraw
          initialData={buildInitialData(offset, opening)}
          excalidrawAPI={registerApi}
          langCode={excalidrawLang(i18n.language)}
          onChange={(elements, appState) => {
            // Excalidraw's own offsets, not the measured ones above: it
            // re-reads them on resize, so the map follows a ribbon row
            // appearing mid-session without anything here observing the DOM.
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
            // Kept whole, tombstones included: undo has to work right up to the
            // moment something is saved, which is when `scene.ts` strips them.
            if (settle.current != null) window.clearTimeout(settle.current);
            settle.current = window.setTimeout(() => {
              settle.current = null;
              setScene(elements);
            }, SCENE_SETTLE_MS);
          }}
          // Excalidraw's shortcuts are single letters and digits, and the
          // funn's title field is a row above on the ribbon: listening on the
          // document would make typing a name pick tools too. The app's own
          // keyboard map stands down from the other side
          // (map/useBackgroundCyclingKeys.ts).
          handleKeyboardGlobally={false}
          UIOptions={{
            canvasActions: {
              // All of these act on Excalidraw's document as a file; here it is
              // a funn or a bilde, saved with the rest of the lokalitet.
              changeViewBackgroundColor: false,
              clearCanvas: false,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              saveAsImage: false,
              toggleTheme: false,
            },
            // No image tool: a lokalitet's images are bilder and each carries a
            // provenance caption, which a PNG dropped in here would not.
            tools: { image: false },
          }}
        />
      )}
    </div>
  );
};
