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

/*
 * The drawing surface — docs/ui-architecture.md §8.7.2, §9.
 *
 * Excalidraw over a frozen map, and nothing but the user's own strokes in the
 * scene: the canvas is transparent and what shows through it is the map
 * itself, still on screen, with every interaction switched off
 * (`session.ts`). Scene units are the CSS pixels of that frozen viewport and
 * the scene is scrolled by the surface's own inset, so a scene coordinate is
 * a pixel of the map underneath and `frame.ts` takes it back to the ground.
 *
 * Excalidraw's canvas can still be panned and zoomed, and a transparent
 * overlay that moved while the map did not would put every stroke over ground
 * nobody traced. So the map is slaved to it: `slaveMapToScene` transforms the
 * map element to match whatever the scene is looking at. Zoom in to trace a
 * detail and the terrain zooms with you, without the OpenLayers view moving
 * and without a tile being asked for.
 *
 * What is *not* here is as deliberate: no background image element, so the
 * scene holds only what the user drew and nothing has to be stripped out of it
 * before it is stored; and no override of Excalidraw's own drawing defaults,
 * so a circle comes out the way it does in Excalidraw — hand-drawn. These are
 * sketches over terrain, not scientific annotation, and a sketch that looks
 * like a measurement claims more than it knows.
 *
 * **The mode is not visible here**, and that is the point of putting it in the
 * session rather than in this component. Funn mode and tegning mode are the
 * same surface with the same tools; what differs is what the *end* of the
 * session reads off the scene — a `FeatureCollection` through `geometry.ts`,
 * or the scene itself through `scene.ts`. Excalidraw offers no supported way
 * to withdraw a tool from its island anyway, so a restriction expressed in the
 * UI would be a restriction the UI could not keep (§9.2).
 */

// Excalidraw carries its own translations, including both Norwegian written
// standards, so the toolbar speaks whatever the rest of the app does. Its
// codes are regioned and ours are not, hence the map rather than a pass-
// through; anything unrecognised falls to English, as `i18n.ts` does.
const LANG_CODES = { nb: 'nb-NO', nn: 'nn-NO', en: 'en' } as const;

const excalidrawLang = (language: string) =>
  LANG_CODES[language.slice(0, 2) as keyof typeof LANG_CODES] ?? 'en';

/*
 * How long the scene may lag behind the pen.
 *
 * `onChange` fires on every pointer sample, and publishing each one would
 * re-render every subscriber of `funnSceneAtom` sixty times a second for a
 * stroke that is not finished yet. Nothing downstream is in a hurry: the
 * autosave settles for 700 ms on top of this (§8.5), and the other reader is a
 * ribbon button whose only question is whether the scene has anything in it.
 * A quarter of the time it takes to move a hand from the canvas to the ribbon
 * is well under the gap between the last stroke and any decision about it.
 */
const SCENE_SETTLE_MS = 150;

type Offset = { x: number; y: number; zoom: number };

const buildInitialData = (
  offset: Offset,
  elements: readonly SceneElement[],
): ExcalidrawInitialDataState => ({
  // A resumed sketch opens on its own strokes; a new session opens on nothing.
  // Passing `[]` rather than omitting the key is the same thing to Excalidraw
  // and one fewer branch here.
  elements,
  appState: {
    // The map is the background. Anything opaque here would hide it.
    viewBackgroundColor: 'transparent',
    theme: 'light',
    // Whatever puts the scene over the ground it belongs on with the map
    // untransformed — 1:1 for a session that framed the view it is looking at,
    // and the frame's own pixel scale for one that was flown back to a stored
    // rectangle (`initialSceneView`).
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
  // The last view pushed at the map, so the transform is only rewritten when
  // it has actually changed: `onChange` fires on every pointer sample while a
  // stroke is being drawn, and almost none of those move the canvas.
  const lastView = useRef('');
  const settle = useRef<number | null>(null);

  /*
   * The scene the surface *opens* on, read once.
   *
   * Held rather than re-read: `funnSceneAtom` is written from this component
   * on every change, and feeding that back into `initialData` would rebuild
   * the scene mid-stroke. What the surface starts with is a fact about the
   * session, and the session does not change while it is up.
   *
   * Off `session.opening`, not off `session.resume`: `Rediger tegningen` seeds
   * a converted geometry with no resume behind it, and reading the resume
   * would open that on a blank canvas over a funn whose shape the first stroke
   * then replaces.
   */
  const [opening] = useState<readonly SceneElement[]>(
    () => session?.opening ?? [],
  );

  /*
   * Scene (0, 0) is the top-left of the *frozen viewport*, but this surface
   * only occupies the strip of it the chrome leaves — the ribbon is above and
   * the bottom slot below, both opaque and both able to change height as rows
   * come and go. So the scene is scrolled by however far the surface sits
   * inside the map, and the strokes land over the pixels they were drawn on.
   *
   * Measured rather than computed from a token: the ribbon's height is its
   * content's (AppShell.module.css), which is the same reason `chromeInsets`
   * measures it too. Layout effect so the first paint is already registered.
   */
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

  /*
   * The surface's scene, lent out for as long as it is up (`sceneNow`).
   *
   * `Ferdig` and `Behold skissen` read the drawing in order to keep it, and
   * the settle below means the atom they would read is up to 150 ms behind the
   * pen — one stroke's worth, and for a sketch that has only just been started,
   * the whole drawing. Handed back on unmount, so a reader is never a door into
   * a canvas that has gone.
   */
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
            /*
             * Excalidraw's own offsets rather than the measured ones above:
             * they are the numbers it actually positions the scene with, and
             * it re-reads them on resize, so the map follows a ribbon row
             * appearing mid-session without anything here observing the DOM.
             */
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
            // The strokes themselves, on a settle — see SCENE_SETTLE_MS. Kept
            // whole, tombstones included: undo has to keep working right up to
            // the moment something is saved, and stripping is what happens
            // then (`scene.ts`).
            if (settle.current != null) window.clearTimeout(settle.current);
            settle.current = window.setTimeout(() => {
              settle.current = null;
              setScene(elements);
            }, SCENE_SETTLE_MS);
          }}
          /*
           * Excalidraw listens on this surface only, not on the document.
           * Its shortcuts are single letters and digits, and the funn's title
           * field is a row above on the ribbon: typing a name into it would
           * otherwise also be picking tools. The app's own keyboard map
           * stands down from the other side for the same reason
           * (map/useBackgroundCyclingKeys.ts).
           */
          handleKeyboardGlobally={false}
          UIOptions={{
            canvasActions: {
              // Every one of these is about Excalidraw's document, and the
              // document here is a funn or a bilde: it is saved by `Lagre`
              // with the rest of the lokalitet, and there is no file to load,
              // export or clear. The background belongs to the map.
              changeViewBackgroundColor: false,
              clearCanvas: false,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              saveAsImage: false,
              toggleTheme: false,
            },
            // No image tool. A lokalitet's images are bilder and every one of
            // them carries a provenance caption (§8.10); a PNG dropped into a
            // drawing would be a picture in the record with nothing behind it.
            tools: { image: false },
          }}
        />
      )}
    </div>
  );
};
