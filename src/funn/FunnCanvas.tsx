// First, and not merged into the import below: it sets the global Excalidraw
// reads to find its fonts, and ES modules evaluate in source order.
import './excalidrawAssets';
import { convertToExcalidrawElements, Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { FileId } from '@excalidraw/excalidraw/element/types';
import type {
  BinaryFileData,
  ExcalidrawInitialDataState,
  NormalizedZoomValue,
} from '@excalidraw/excalidraw/types';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './FunnCanvas.module.css';
import type { FunnSnapshot } from './snapshot';

/*
 * The drawing surface — docs/ui-architecture.md §8.7.2.
 *
 * Excalidraw over a frozen map. The photograph taken by `snapshot.ts` goes in
 * as a locked image element at scene (0, 0), the view background is
 * transparent, and the scene is scrolled so that element lands exactly on the
 * real map underneath. Nothing about the transition is visible: the pixels
 * over the map are the pixels of the map.
 *
 * The snapshot is scaffolding, not content. It is stripped before the scene is
 * stored — what a funn keeps is the frame and a description of the ground, so
 * the view can be *made again* rather than merely remembered (`frame.ts`).
 * `FREEZE_ELEMENT_ID` is how it is found again to be taken out, which is why
 * the ids are not regenerated below.
 *
 * Why a still and not a live map: it is what lets Excalidraw stay ignorant of
 * projections, tile loading and zoom levels. Scene units are CSS pixels of the
 * frozen viewport and one fixed affine takes them to the ground. It also makes
 * panning and zooming *inside* the session coherent — zoom in to trace a
 * detail and the background zooms with you, which a transparent overlay on a
 * static map could not do without sliding out of register.
 */

const FREEZE_ELEMENT_ID = 'funn-freeze';
const FREEZE_FILE_ID = 'funn-freeze' as FileId;

// Excalidraw carries its own translations, including both Norwegian written
// standards, so the toolbar speaks whatever the rest of the app does. Its
// codes are regioned and ours are not, hence the map rather than a pass-
// through; anything unrecognised falls to English, as `i18n.ts` does.
const LANG_CODES = { nb: 'nb-NO', nn: 'nn-NO', en: 'en' } as const;

const excalidrawLang = (language: string) =>
  LANG_CODES[language.slice(0, 2) as keyof typeof LANG_CODES] ?? 'en';

type Offset = { x: number; y: number };

const buildInitialData = (
  snapshot: FunnSnapshot,
  offset: Offset,
): ExcalidrawInitialDataState => {
  const { frame, dataUrl } = snapshot;
  const file: BinaryFileData = {
    id: FREEZE_FILE_ID,
    mimeType: 'image/png',
    dataURL: dataUrl as BinaryFileData['dataURL'],
    created: Date.now(),
  };
  return {
    elements: convertToExcalidrawElements(
      [
        {
          type: 'image',
          id: FREEZE_ELEMENT_ID,
          fileId: FREEZE_FILE_ID,
          x: 0,
          y: 0,
          width: frame.widthPx,
          height: frame.heightPx,
          // Locked, so it cannot be selected, nudged or deleted — and so
          // hit-testing passes straight through it to whatever is being drawn.
          locked: true,
          // The bytes are already here; without this Excalidraw waits for an
          // upload that is never coming and renders a placeholder.
          status: 'saved',
        },
      ],
      { regenerateIds: false },
    ),
    files: { [FREEZE_FILE_ID]: file },
    appState: {
      // The map is the background. Anything opaque here would hide it.
      viewBackgroundColor: 'transparent',
      theme: 'light',
      // 1:1. A scene unit is a CSS pixel of the frozen viewport, and at any
      // other zoom the snapshot would not be the map it was taken from.
      zoom: { value: 1 as NormalizedZoomValue },
      scrollX: offset.x,
      scrollY: offset.y,
      // Architect, not artist: a funn is a feature traced off the ground, and
      // a hand-drawn wobble on it is a claim about the outline that isn't
      // true. Outlines rather than fills for the same reason — the point of
      // the drawing is the terrain it is over.
      currentItemRoughness: 0,
      currentItemStrokeWidth: 2,
      currentItemBackgroundColor: 'transparent',
    },
    scrollToContent: false,
  };
};

export const FunnCanvas = ({ snapshot }: { snapshot: FunnSnapshot }) => {
  const { i18n } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<Offset | null>(null);

  /*
   * Scene (0, 0) is the top-left of the *frozen viewport*, but this surface
   * only occupies the strip of it the chrome leaves — the ribbon is above and
   * the bottom slot below, both opaque and both able to change height as rows
   * come and go. So the scene is scrolled by however far the surface sits
   * inside the map, and the snapshot lands back over the pixels it was taken
   * from.
   *
   * Measured rather than computed from a token: the ribbon's height is its
   * content's (AppShell.module.css), which is the same reason `chromeInsets`
   * measures it too. Layout effect so the first paint is already registered.
   */
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const here = host.getBoundingClientRect();
    setOffset({ x: -here.left, y: -here.top });
  }, []);

  return (
    <div className={styles.surface} ref={hostRef}>
      {offset && (
        <Excalidraw
          initialData={buildInitialData(snapshot, offset)}
          langCode={excalidrawLang(i18n.language)}
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
              // document here is a funn: it is saved by `Lagre` with the rest
              // of the lokalitet, and there is no file to load, export or
              // clear. The background belongs to the map.
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
