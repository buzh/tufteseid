import type { FeatureCollection } from 'geojson';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef } from 'react';
import type { LocalityBbox } from '../api/localities';
import type { FunnFrame } from '../funn/frame';
import { geometryExtent4326, sceneToGeometry } from '../funn/geometry';
import type { SceneElement } from '../funn/scene';
import { funnSceneAtom, funnSessionAtom, sceneNow } from '../funn/session';

// How still the pen has to be before the drawing is written back.
const SETTLE_MS = 700;

export type FunnAutosaveHandlers = {
  /** Nothing is watched while this is false. */
  active: boolean;
  /** Null until the first shape lands. */
  funnId: string | null;
  onCreate: (geometry: FeatureCollection) => Promise<boolean>;
  onUpdate: (id: string, geometry: FeatureCollection) => Promise<boolean>;
  /** The drawing's extent in EPSG:4326 after each change; null when empty. */
  onExtent: (extent: LocalityBbox | null) => void;
};

/**
 * A funn saves itself: the first finished shape is the record, every stroke
 * after it a patch. Three rules hold it together — an empty scene is never a
 * delete, one write is in flight at a time (two creates would be two funn), and
 * the first scene after arming is a baseline rather than a change.
 */
export const useFunnAutosave = (handlers: FunnAutosaveHandlers) => {
  const session = useAtomValue(funnSessionAtom);
  const scene = useAtomValue(funnSceneAtom);
  // Through a ref: these fire from a timer and must see the current callbacks.
  const ref = useRef(handlers);
  ref.current = handlers;

  const input = useRef<{
    frame: FunnFrame;
    elements: readonly SceneElement[];
  } | null>(null);
  input.current = session ? { frame: session.frame, elements: scene } : null;

  const timer = useRef<number | null>(null);
  const flushRef = useRef<() => void>(() => {});
  // As last handed to the buffer: a colour swap or a selection costs no write.
  const lastWritten = useRef<string | null>(null);
  const busy = useRef(false);
  const dirty = useRef(false);
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

  // Through `sceneNow`: the atom is behind a settle worth half a stroke.
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
        // A failed write must not look saved.
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

  // Split from the strokes because the cleanup belongs to `active` alone: with
  // the scene in these deps it would report "nothing drawn" mid-stroke.
  useEffect(() => {
    if (!active) return;
    armed.current = false;
    return () => {
      cancelTimer();
      armed.current = false;
      ref.current.onExtent(null);
    };
  }, [active]);

  // The first run after arming takes the baseline instead of writing; effects
  // run in declaration order, so `armed` is already false by then.
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
