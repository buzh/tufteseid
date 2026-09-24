// Where the reading box sits, how big it is and which way round it is laid
// out. Held outside the component because the reader is keyed on the spot: a
// box arranged around one reading must survive opening the next.

import { atom, useAtom } from 'jotai';
import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/** `wide` is a bar along an edge, `tall` a column down one. */
export type ReaderLayout = 'wide' | 'tall';

type Side = 'left' | 'right' | 'top' | 'bottom';

type Frame = { left: number; top: number; width: number; height: number };

type Placement = {
  /** What the box is laid out at, in map pixels. */
  frame: Frame;
  /** The wall it is stuck to, or null for a box standing free. */
  side: Side | null;
};

export const readerLayoutAtom = atom<ReaderLayout>('wide');

/** Null until the box has been moved or resized: until then the layout's own
 *  CSS places it, so a reading opens where the layout says it should. */
const readerPlacementAtom = atom<Placement | null>(null);

const MIN_WIDTH = 260;
const MIN_HEIGHT = 140;

/** `--mantine-spacing-xs`, the gap every box on the map keeps from the edge.
 *  A dock is flush with that gap, not with the pixel. */
const GUTTER = 10;

/** A docked box eats at most this much of the map across. Shoving the wide
 *  bar against a side wall would otherwise leave a column half the map. */
const DOCK_SHARE = 1 / 3;

const LAYOUT_OF: Record<Side, ReaderLayout> = {
  left: 'tall',
  right: 'tall',
  top: 'wide',
  bottom: 'wide',
};

type Bounds = { width: number; height: number };

/** The map rectangle the box floats over. `.reader` is absolute, so its
 *  offset parent is the one positioned element around the map. */
const boundsOf = (box: HTMLElement): Bounds | null => {
  const parent = box.offsetParent;
  return parent instanceof HTMLElement
    ? { width: parent.clientWidth, height: parent.clientHeight }
    : null;
};

const frameOf = (box: HTMLElement): Frame | null => {
  const parent = box.offsetParent;
  if (!(parent instanceof HTMLElement)) return null;
  const mine = box.getBoundingClientRect();
  const theirs = parent.getBoundingClientRect();
  return {
    left: mine.left - theirs.left,
    top: mine.top - theirs.top,
    width: mine.width,
    height: mine.height,
  };
};

/** Wholly inside the map, so the box can never be put somewhere it cannot be
 *  grabbed back from. */
const clamped = (frame: Frame, within: Bounds): Frame => {
  const width = Math.min(Math.max(frame.width, MIN_WIDTH), within.width);
  const height = Math.min(Math.max(frame.height, MIN_HEIGHT), within.height);
  return {
    width,
    height,
    left: Math.min(Math.max(frame.left, 0), within.width - width),
    top: Math.min(Math.max(frame.top, 0), within.height - height),
  };
};

/** How far past each wall a frame reaches. Nothing positive means it is still
 *  inside the map. */
const overshoot = (frame: Frame, within: Bounds): Record<Side, number> => ({
  left: -frame.left,
  top: -frame.top,
  right: frame.left + frame.width - within.width,
  bottom: frame.top + frame.height - within.height,
});

/** The wall a frame has been pushed hardest through, if any. Pushing through
 *  is the whole gesture: a box at rest keeps the gutter, so no ordinary nudge
 *  can reach a wall by accident. */
const wallCrossed = (frame: Frame, within: Bounds): Side | null => {
  const past = overshoot(frame, within);
  const worst = (Object.keys(past) as Side[]).reduce((a, b) =>
    past[b] > past[a] ? b : a,
  );
  return past[worst] > 0 ? worst : null;
};

/** What the box brought with it, but never more than its share of the map and
 *  never less than the reading needs. */
const thickness = (want: number, room: number, least: number): number =>
  Math.min(
    Math.max(Math.min(want, room * DOCK_SHARE), least),
    room - 2 * GUTTER,
  );

/** Flush against one wall and filling it. */
const dockedTo = (side: Side, from: Frame, within: Bounds): Frame => {
  if (side === 'left' || side === 'right') {
    const width = thickness(from.width, within.width, MIN_WIDTH);
    return clamped(
      {
        width,
        height: within.height - 2 * GUTTER,
        top: GUTTER,
        left: side === 'left' ? GUTTER : within.width - GUTTER - width,
      },
      within,
    );
  }
  const height = thickness(from.height, within.height, MIN_HEIGHT);
  return clamped(
    {
      height,
      width: within.width - 2 * GUTTER,
      left: GUTTER,
      top: side === 'top' ? GUTTER : within.height - GUTTER - height,
    },
    within,
  );
};

const settled = (placement: Placement, within: Bounds): Placement =>
  placement.side
    ? {
        side: placement.side,
        frame: dockedTo(placement.side, placement.frame, within),
      }
    : { side: null, frame: clamped(placement.frame, within) };

type Gesture = {
  mode: 'move' | 'resize';
  from: Frame;
  within: Bounds;
  x: number;
  y: number;
};

export const useReaderWindow = () => {
  const [layout, setLayoutAtom] = useAtom(readerLayoutAtom);
  const [placement, setPlacement] = useAtom(readerPlacementAtom);
  const boxRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);

  // Choosing a layout is also the way back: a box docked or dragged somewhere
  // unhelpful is put right by asking for the shape it should have had.
  const setLayout = useCallback(
    (next: ReaderLayout) => {
      setLayoutAtom(next);
      setPlacement(null);
    },
    [setLayoutAtom, setPlacement],
  );

  // A window resized under the box leaves a free one off the map and a docked
  // one short of its wall — as does one resized between two readings, hence
  // the pass on mount too.
  useEffect(() => {
    const onResize = () => {
      const box = boxRef.current;
      const within = box && boundsOf(box);
      if (within) setPlacement((was) => (was ? settled(was, within) : null));
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setPlacement]);

  const start =
    (mode: Gesture['mode']) => (event: ReactPointerEvent<HTMLElement>) => {
      // Primary button only: the context menu swallows a right-click's
      // `pointerup`, so that drag would never end.
      if (!event.isPrimary || event.button !== 0) return;
      // The fold, the close and the layout switch share the title row.
      if (mode === 'move' && (event.target as HTMLElement).closest('button')) {
        return;
      }
      const box = boxRef.current;
      const from = box && frameOf(box);
      const within = box && boundsOf(box);
      if (!from || !within) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = {
        mode,
        from,
        within,
        x: event.clientX,
        y: event.clientY,
      };
      // Take the placement over from the CSS now rather than on the first
      // move, or the box jumps by whatever the two disagree about. A press
      // that never turns into a drag leaves an existing dock alone.
      setPlacement(
        (was) => was ?? { side: null, frame: clamped(from, within) },
      );
    };

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const held = gesture.current;
    if (!held) return;
    const { from, within } = held;
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;

    if (held.mode === 'resize') {
      setPlacement({
        side: null,
        frame: clamped(
          {
            ...from,
            // Capped against the corner it is dragged from, not the map, or
            // growing past the edge would shove the box sideways.
            width: Math.min(from.width + dx, within.width - from.left),
            height: Math.min(from.height + dy, within.height - from.top),
          },
          within,
        ),
      });
      return;
    }

    // Unclamped on purpose: a frame pushed through a wall is what asks for the
    // dock, and a docked frame is inside the map again, so nothing ever ends
    // up off it.
    const pushed = { ...from, left: from.left + dx, top: from.top + dy };
    const side = wallCrossed(pushed, within);
    if (!side) {
      setPlacement({ side: null, frame: pushed });
      return;
    }
    // A wall implies a shape: down the side is a column, along the top or the
    // bottom a bar. Switching here rather than on release is the preview.
    setLayoutAtom(LAYOUT_OF[side]);
    setPlacement({ side, frame: dockedTo(side, pushed, within) });
  };

  const end = (event: ReactPointerEvent<HTMLElement>) => {
    // A pointer that was refused above never took the capture.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    gesture.current = null;
  };

  const handlers = (mode: Gesture['mode']) => ({
    onPointerDown: start(mode),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
  });

  return {
    layout,
    setLayout,
    boxRef,
    /** Moved, resized or docked, so the layout's own anchor no longer
     *  applies. */
    placed: placement !== null,
    frameStyle: placement?.frame,
    dragHandle: handlers('move'),
    resizeHandle: handlers('resize'),
  };
};
