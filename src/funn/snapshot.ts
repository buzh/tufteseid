import Map from 'ol/Map';
import { compositeMapCanvases, whenRendered } from '../map/composite';
import { captureFunnFrame, type FunnFrame } from './frame';

/*
 * Freezing the map so a funn can be drawn on it.
 *
 * Pressing the pen does not hand Excalidraw a live map — it hands it a
 * photograph of one. The view stops, the layers are flattened into a single
 * image, and that image becomes a locked background element in the scene. The
 * map underneath cannot pan, zoom or change ground until the pen goes down
 * again, and because the image is pixel-identical to what was on screen, none
 * of that is visible: the map appears to simply stop being interactive.
 *
 * That is what buys the whole design. Excalidraw never has to know about
 * projections, tile loading or zoom levels; it draws on a still, and `frame.ts`
 * translates its coordinates back to ground afterwards.
 *
 * The snapshot itself is **not kept**. It is scaffolding for the drawing
 * session and is stripped before the scene is serialized — what gets stored
 * is the frame plus a description of which ground was on screen, so the view
 * can be reproduced rather than merely remembered. A stored snapshot per funn
 * would be storage spent on pixels the map can make again.
 */

export type FunnSnapshot = {
  /** Scene↔ground for the duration of the session. */
  frame: FunnFrame;
  /** PNG data URL, sized `frame.widthPx * pixelRatio` across. */
  dataUrl: string;
  /** What the image was captured at, so the scene can place it at 1:1. */
  pixelRatio: number;
};

const toDataUrl = (canvas: HTMLCanvasElement): Promise<string | null> =>
  new Promise((resolve) => {
    // `toBlob` + FileReader rather than `toDataURL`, which encodes a
    // full-viewport HiDPI canvas synchronously and janks the freeze at
    // exactly the moment the user is watching for it.
    canvas.toBlob((blob) => {
      if (!blob) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    }, 'image/png');
  });

/**
 * Wait for the map to settle, then photograph it.
 *
 * Captured at `devicePixelRatio` so the freeze matches the screen rather than
 * looking like a resampled copy of it — the scene coordinate system stays in
 * CSS pixels regardless (`frame.ts`), so the extra resolution costs nothing
 * but sharpness.
 *
 * Resolves null if the map never settles or has no size; the caller should
 * decline to enter draw mode rather than freeze over a half-loaded map.
 */
export const captureFunnSnapshot = async (
  map: Map,
  // A view that moves while we wait invalidates the frame, so the capture
  // starts over. Bounded because "the view keeps moving" is a reachable state
  // — a drag-resize of the window, a still-animating zoom — and an unbounded
  // retry there would spin for as long as the user held the mouse down.
  attemptsLeft = 3,
): Promise<FunnSnapshot | null> => {
  const frame = captureFunnFrame(map);
  if (!frame) return null;

  const settled = whenRendered(map);
  map.renderSync();
  if (!(await settled)) return null;

  // Re-read rather than trusting the frame taken before the wait: a tile that
  // arrived late does not move the view, but a resize during those seconds
  // would, and a frame that disagrees with the pixels is a funn in the wrong
  // place.
  const after = captureFunnFrame(map);
  if (
    !after ||
    after.widthPx !== frame.widthPx ||
    after.heightPx !== frame.heightPx ||
    after.extent.some((v, i) => v !== frame.extent[i])
  ) {
    if (!after || attemptsLeft <= 1) {
      console.warn('[funn/snapshot] view would not hold still, giving up');
      return null;
    }
    return captureFunnSnapshot(map, attemptsLeft - 1);
  }

  const pixelRatio = window.devicePixelRatio || 1;
  const canvas = compositeMapCanvases(map, pixelRatio);
  if (!canvas) return null;
  const dataUrl = await toDataUrl(canvas);
  if (!dataUrl) return null;

  return { frame, dataUrl, pixelRatio };
};
