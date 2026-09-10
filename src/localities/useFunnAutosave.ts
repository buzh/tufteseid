import type { FeatureCollection } from 'geojson';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef } from 'react';
import type { LocalityBbox } from '../api/localities';
import { getDrawLayer } from '../draw/drawControls/hooks/mapLayers';
import { mapAtom } from '../map/atoms';
import {
  getDrawLayerExtent4326,
  serializeDrawLayer,
} from './serializeDrawLayer';

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
 * through a `cancelDraft` that cleared the draw layer without asking. So this
 * watches the shared draw layer instead: the first finished shape *is* the
 * record, and every stroke after it is a patch.
 *
 * Three rules hold the mechanism together:
 *
 * - **An empty layer is never a delete.** Clearing the draw layer is how
 *   drawing *stops*, so a serialization that comes back empty is ignored and
 *   the record keeps the last shape it had. Removing a funn is the list's job.
 * - **One write at a time.** Overlapping writes are merely wasteful for an
 *   update and actively wrong for the first one, which creates the record —
 *   two in flight is two funn. A change arriving mid-write re-arms the timer
 *   from the completion handler rather than racing it, which also gives React
 *   time to hand the new `funnId` back through `handlers`.
 * - **`rebind()` is what re-points the pen.** Loading an existing funn's
 *   shapes onto the layer, or clearing them after an undo, is not an edit; the
 *   caller says so at the moment it knows, rather than the hook trying to
 *   infer it from an event it may or may not still be subscribed to.
 */
export const useFunnAutosave = (handlers: FunnAutosaveHandlers) => {
  const map = useAtomValue(mapAtom);
  // Read through a ref, like useWorkspaceKeys: these fire from a timer and
  // must see the current callbacks, and subscribing to them would re-register
  // the source listeners on every keystroke in the title field.
  const ref = useRef(handlers);
  ref.current = handlers;

  const timer = useRef<number | null>(null);
  const flushRef = useRef<() => void>(() => {});
  // The geometry as last handed to the server, so an event that changes
  // nothing (a redraw, a reselect) costs no request.
  const lastWritten = useRef<string | null>(null);
  const busy = useRef(false);
  const dirty = useRef(false);

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

  const flush = useCallback(() => {
    cancelTimer();
    const h = ref.current;
    if (!h.active) return;
    const projection = map.getView().getProjection().getCode();
    const geometry = serializeDrawLayer(projection);
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
        // compared against a baseline that never reached the server.
        if (!ok) lastWritten.current = null;
      })
      .finally(() => {
        busy.current = false;
        if (dirty.current) {
          dirty.current = false;
          schedule();
        }
      });
  }, [map, schedule]);
  flushRef.current = flush;

  const rebind = useCallback(() => {
    cancelTimer();
    dirty.current = false;
    const projection = map.getView().getProjection().getCode();
    const geometry = serializeDrawLayer(projection);
    lastWritten.current = geometry ? JSON.stringify(geometry) : null;
  }, [map]);

  const active = handlers.active;
  useEffect(() => {
    if (!active) return;
    const source = getDrawLayer()?.getSource();
    if (!source) return;
    const projection = map.getView().getProjection().getCode();

    // Whatever is on the layer at this moment is the baseline: nothing for a
    // new funn, the record's own shapes when re-editing one.
    rebind();
    ref.current.onExtent(getDrawLayerExtent4326(projection));

    const onChange = () => {
      ref.current.onExtent(getDrawLayerExtent4326(projection));
      schedule();
    };
    source.on('addfeature', onChange);
    source.on('changefeature', onChange);
    source.on('removefeature', onChange);

    return () => {
      source.un('addfeature', onChange);
      source.un('changefeature', onChange);
      source.un('removefeature', onChange);
      cancelTimer();
      ref.current.onExtent(null);
    };
  }, [active, map, rebind, schedule]);

  return { flush, rebind };
};
