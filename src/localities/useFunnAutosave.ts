import type { FeatureCollection } from 'geojson';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef } from 'react';
import type { LocalityBbox } from '../api/localities';
import type { FunnFrame } from '../funn/frame';
import { geometryExtent4326, sceneToGeometry } from '../funn/geometry';
import type { SceneElement } from '../funn/scene';
import { funnSceneAtom, funnSessionAtom, sceneNow } from '../funn/session';

// How still the pen has to be before the drawing is written back. Long enough
// that dragging a vertex is one save and not forty, short enough that the gap
// between "I drew it" and "it exists" is never something you'd notice.
const SETTLE_MS = 700;

export type FunnAutosaveHandlers = {
  /** Drawing is armed. Nothing is watched while this is false. */
  active: boolean;
  /** The record the pen is bound to; null until the first shape lands. */
  funnId: string | null;
  /** First finished shape: make a record out of it. */
  onCreate: (geometry: FeatureCollection) => Promise<boolean>;
  /** Every change after that: write the drawing back. */
  onUpdate: (id: string, geometry: FeatureCollection) => Promise<boolean>;
  /** The drawing's extent in EPSG:4326 after each change; null when empty. */
  onExtent: (extent: LocalityBbox | null) => void;
};

/**
 * A funn saves itself.
 *
 * The draft used to be a form: draw, name, press Lagre. Everything about that
 * was a way to lose work — Save was disabled until the title had something in
 * it and said nothing about why, and half a dozen ordinary gestures (Escape,
 * opening the extract, adjusting the rectangle, closing the workspace) went
 * through a `cancelDraft` that cleared the draw layer without asking. So the
 * first finished shape *is* the record, and every stroke after it is a patch.
 *
 * **What it watches has moved.** It used to subscribe to an OpenLayers vector
 * source's `addfeature`/`changefeature`/`removefeature`; the pen is Excalidraw
 * now (§9), so the input is `funnSceneAtom` and the conversion to geometry is
 * `funn/geometry.ts`. Everything below that line is unchanged, deliberately —
 * the settle, the one-write-at-a-time rule and the empty-is-never-a-delete
 * rule were never about vector features.
 *
 * Three rules hold the mechanism together:
 *
 * - **An empty scene is never a delete.** A scene with nothing convertible in
 *   it — cleared, or holding only text — leaves the record with the last shape
 *   it had. Removing a funn is the list's job.
 * - **One write at a time.** Overlapping writes are merely wasteful for an
 *   update and actively wrong for the first one, which creates the record —
 *   two in flight is two funn. A change arriving mid-write re-arms the timer
 *   from the completion handler rather than racing it, which also gives React
 *   time to hand the new `funnId` back through `handlers`.
 * - **The first scene after arming is a baseline, not a change.** Opening an
 *   existing funn's geometry under the pen is not an edit of it, and the pen
 *   going down over an empty canvas is not one either. The caller used to have
 *   to say which by calling `rebind()`; the arming effect below answers it for
 *   both, because there is no third way in.
 */
export const useFunnAutosave = (handlers: FunnAutosaveHandlers) => {
  const session = useAtomValue(funnSessionAtom);
  const scene = useAtomValue(funnSceneAtom);
  // Read through a ref, like useWorkspaceKeys: these fire from a timer and
  // must see the current callbacks, and subscribing to them would re-register
  // everything below on every keystroke in the title field.
  const ref = useRef(handlers);
  ref.current = handlers;

  // The frame and the strokes as of this render, for the timer to read. A
  // session that has ended leaves nothing to convert, which is the same state
  // as `active` being false and is handled the same way.
  const input = useRef<{
    frame: FunnFrame;
    elements: readonly SceneElement[];
  } | null>(null);
  input.current = session ? { frame: session.frame, elements: scene } : null;

  const timer = useRef<number | null>(null);
  const flushRef = useRef<() => void>(() => {});
  // The geometry as last handed to the buffer, so a change that converts to
  // the same features (a colour swap, a selection) costs no write.
  const lastWritten = useRef<string | null>(null);
  const busy = useRef(false);
  const dirty = useRef(false);
  // Whether this arming has taken its baseline yet — see the effect below.
  const armed = useRef(false);

  const cancelTimer = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const schedule = useCallback(() => {
    cancelTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      flushRef.current();
    }, SETTLE_MS);
  }, []);

  // Through `sceneNow` rather than off the atom: this runs from a timer and
  // from `Ferdig`, and the settle in front of the atom is half a stroke's
  // worth of drawing that the flush would otherwise write the funn without.
  const geometryNow = (): FeatureCollection | null => {
    const src = input.current;
    return src ? sceneToGeometry(src.frame, sceneNow(src.elements)) : null;
  };

  const flush = useCallback(() => {
    cancelTimer();
    const h = ref.current;
    if (!h.active) return;
    const geometry = geometryNow();
    if (!geometry) return;
    const encoded = JSON.stringify(geometry);
    if (encoded === lastWritten.current) return;
    if (busy.current) {
      dirty.current = true;
      return;
    }
    lastWritten.current = encoded;
    busy.current = true;
    const done = h.funnId
      ? h.onUpdate(h.funnId, geometry)
      : h.onCreate(geometry);
    done
      .then((ok) => {
        // A failed write must not look saved, or the next change would be
        // compared against a baseline that never reached the buffer.
        if (!ok) lastWritten.current = null;
      })
      .finally(() => {
        busy.current = false;
        if (dirty.current) {
          dirty.current = false;
          schedule();
        }
      });
  }, [schedule]);
  flushRef.current = flush;

  const rebind = useCallback(() => {
    cancelTimer();
    dirty.current = false;
    const geometry = geometryNow();
    lastWritten.current = geometry ? JSON.stringify(geometry) : null;
  }, []);

  const active = handlers.active;

  /*
   * Arming and disarming, separately from the strokes.
   *
   * Split in two because the cleanup belongs to `active` alone: with the scene
   * in this effect's deps, putting the pen down would run on every pointer
   * settle and report "nothing drawn" in the middle of a stroke.
   */
  useEffect(() => {
    if (!active) return;
    armed.current = false;
    return () => {
      cancelTimer();
      armed.current = false;
      ref.current.onExtent(null);
    };
  }, [active]);

  /*
   * The strokes.
   *
   * The first run after arming takes the baseline instead of scheduling a
   * write: whatever is in the scene at that moment is either nothing (a new
   * funn) or the record's own geometry opened for editing, and neither is a
   * change. Effects run in declaration order, so `armed` is already false by
   * the time this sees a fresh arming.
   */
  useEffect(() => {
    if (!active) return;
    const src = input.current;
    ref.current.onExtent(
      src ? geometryExtent4326(src.frame, src.elements) : null,
    );
    if (!armed.current) {
      armed.current = true;
      rebind();
      return;
    }
    schedule();
  }, [active, scene, rebind, schedule]);

  return { flush };
};
