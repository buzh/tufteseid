// Drag a frame along the rail to its place in the exhibit. Touch pointers are
// left alone so the rail keeps its native scroll (touch reorders with ←/→);
// pointer capture is what keeps the handlers off `window`; and the index handed
// to `reorderBilde` is a gap in the list with the dragged record removed.

import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

// Far enough that a click with a shaky hand is still a click.
const THRESHOLD_PX = 4;

// Edge scrolling, per move event rather than per frame: no loop to cancel.
const EDGE_PX = 44;
const EDGE_STEP_PX = 24;

export type RailReorder = {
  /** The frame being dragged, or null. */
  dragId: string | null;
  /** Gap index in the list *without* `dragId`, or null while not dragging. */
  insertAt: number | null;
  /** Every frame reports its element, so the drop gap can be measured. */
  register: (id: string, el: HTMLElement | null) => void;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>, id: string) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  /** True once per completed drag: the click it produced is not a selection. */
  consumeClick: () => boolean;
};

/** `ids` is the reorderable frames in display order, without the borrowed
 * tail. `onReorder` is null in show, but the props come back either way. */
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

  // A drag in progress must see the current order, not the pointerdown one.
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

  // Escape leaves the exhibit untouched.
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
