/*
 * Drag a frame along the bilder rail to its place in the exhibit (§4.4).
 *
 * Hand-rolled pointer handling rather than a drag library, for the reason
 * everything else here is hand-rolled: the workstation cannot regenerate
 * `package-lock.json`, so a new dependency is not available at any price. It
 * is about eighty lines, which is cheaper than the argument would be.
 *
 * Four decisions worth knowing before changing it:
 *
 * - **Mouse and pen only.** A touch pointer is left alone so the rail keeps
 *   its native horizontal scroll — on a phone the whole rail is two frames
 *   wide, and stealing the scroll gesture to reorder would make a long
 *   exhibit unreachable. Touch reorders with the ←/→ buttons in the verb row,
 *   which are also the keyboard path and are not going away.
 * - **A drag starts at 4 px, not at pointerdown.** Clicking a frame selects
 *   it, and that has to keep working; below the threshold nothing has
 *   happened yet. Past it, the click that pointerup would otherwise produce
 *   is swallowed — `consumeClick` — because ending a drag on top of a frame
 *   is not a request to select that frame.
 * - **Pointer capture, so there are no window listeners.** The frame that
 *   went down keeps receiving the move and up events even when the pointer
 *   leaves it, which is the whole reason the handlers can live on the element
 *   in JSX instead of being attached and torn down against `window`.
 * - **Indices are in *rest* space.** `reorderBilde(id, to)` splices the
 *   dragged record into the list with itself already removed, so `to` counts
 *   gaps in that shorter list. Computing it against the frames still on
 *   screen — which is exactly the list without the dragged one — means the
 *   two agree without an off-by-one correction anywhere.
 */

import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

// Far enough that a click with a shaky hand is still a click.
const THRESHOLD_PX = 4;

// Dragging towards the end of a rail longer than the surface: how close to
// the edge starts scrolling, and by how much per move event. Per *event*
// rather than per frame, so there is no animation loop to cancel — hold still
// at the edge and it stops, which is a fair reading of holding still.
const EDGE_PX = 44;
const EDGE_STEP_PX = 24;

export type RailReorder = {
  /** The frame being dragged, or null. */
  dragId: string | null;
  /** Gap index in the list *without* `dragId`, or null while not dragging. */
  insertAt: number | null;
  /** Every frame reports its element here, so the drop gap can be measured. */
  register: (id: string, el: HTMLElement | null) => void;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>, id: string) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  /** True once per completed drag: the click it produced is not a selection. */
  consumeClick: () => boolean;
};

/**
 * @param ids   the reorderable frames, in display order. The borrowed tail is
 *              not among them (§7) — those records are not in this lokalitet,
 *              so there is no position in its exhibit to move them to.
 * @param railRef the scrolling container, for edge scrolling.
 * @param onReorder null in show, where nothing writes (§2). With no handler
 *              the hook still renders its no-op props, so the caller does not
 *              have to branch on the stance twice.
 */
export const useRailReorder = (
  ids: string[],
  railRef: RefObject<HTMLElement | null>,
  onReorder: ((id: string, toIndex: number) => void) | null,
): RailReorder => {
  const [dragId, setDragId] = useState<string | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);

  const els = useRef(new Map<string, HTMLElement>());
  const drag = useRef<{ id: string; startX: number; active: boolean } | null>(
    null,
  );
  const blockClick = useRef(false);

  // Read inside pointer handlers, which are recreated on every render anyway
  // — but the *drag in progress* must see the current order, not the one that
  // was current when the pointer went down.
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const insertRef = useRef<number | null>(null);

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  }, []);

  const stop = useCallback(() => {
    drag.current = null;
    insertRef.current = null;
    setDragId(null);
    setInsertAt(null);
  }, []);

  // Escape gets you out with the exhibit untouched, like every other
  // in-progress gesture in the app.
  useEffect(() => {
    if (!dragId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      blockClick.current = true;
      stop();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dragId, stop]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, id: string) => {
      if (!onReorder || e.pointerType === 'touch' || e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { id, startX: e.clientX, active: false };
    },
    [onReorder],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      if (!d.active) {
        if (Math.abs(e.clientX - d.startX) < THRESHOLD_PX) return;
        d.active = true;
        setDragId(d.id);
      }

      const rail = railRef.current;
      if (rail) {
        const r = rail.getBoundingClientRect();
        if (e.clientX < r.left + EDGE_PX) rail.scrollLeft -= EDGE_STEP_PX;
        else if (e.clientX > r.right - EDGE_PX) rail.scrollLeft += EDGE_STEP_PX;
      }

      const rest = idsRef.current.filter((id) => id !== d.id);
      let at = rest.length;
      for (let i = 0; i < rest.length; i++) {
        const el = els.current.get(rest[i]);
        if (!el) continue;
        const box = el.getBoundingClientRect();
        if (e.clientX < box.left + box.width / 2) {
          at = i;
          break;
        }
      }
      if (at !== insertRef.current) {
        insertRef.current = at;
        setInsertAt(at);
      }
    },
    [railRef],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const at = insertRef.current;
      if (d.active) {
        blockClick.current = true;
        // `reorderBilde` returns on a no-op move, so landing where it started
        // costs nothing and needs no check here.
        if (at != null && onReorder) onReorder(d.id, at);
      }
      stop();
    },
    [onReorder, stop],
  );

  const consumeClick = useCallback(() => {
    const blocked = blockClick.current;
    blockClick.current = false;
    return blocked;
  }, []);

  return {
    dragId,
    insertAt,
    register,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: stop,
    consumeClick,
  };
};
