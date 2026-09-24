// Where the reading box sits, how big it may get and which way round it is
// laid out. Held outside the component because the reader is keyed on the
// spot: a box arranged around one reading must survive opening the next.
//
// The box always hugs its content. Nothing here ever sets a size, only a
// corner to hang from and a ceiling to stop at, so a reading with three
// pictures and no prose gets a box that small.

import { atom, useAtom } from 'jotai';
import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/** `wide` is a bar along an edge, `tall` a column down one. */
export type ReaderLayout = 'wide' | 'tall';

type Side = 'left' | 'right' | 'top' | 'bottom';

type Size = { width: number; height: number };

/** How big the box may get, never how big it is. Absent means the layout's own
 *  ceiling stands: only the grip sets one of these. */
type Ceiling = { maxWidth?: number; maxHeight?: number };

type Placement = Ceiling & {
  /** The wall it is stuck to, or null for a box standing free. */
  side: Side | null;
  /** The corner it hangs from. The axis a dock pins is read off `side`
   *  instead, so one of these is ignored while docked. */
  left: number;
  top: number;
};

export const readerLayoutAtom = atom<ReaderLayout>('wide');

/** Null until the box has been moved, resized or docked: until then the
 *  layout's own CSS places it, so a reading opens where the layout says. */
const readerPlacementAtom = atom<Placement | null>(null);

/** Floors for the ceiling: under these the strip has nothing to show. */
const MIN_WIDTH = 260;
const MIN_HEIGHT = 140;

/** `--mantine-spacing-xs`, the gap every box on the map keeps from the edge.
 *  A dock is flush with that gap, not with the pixel. */
const GUTTER = 10;

/** A wall implies a shape: down the side is a column, along the top or the
 *  bottom a bar. That shape is all a dock is besides the anchor — the layout's
 *  own ceilings are what make a column narrow, so the dock keeps none of its
 *  own and drops any the grip had set. */
const LAYOUT_OF: Record<Side, ReaderLayout> = {
  left: 'tall',
  right: 'tall',
  top: 'wide',
  bottom: 'wide',
};

type Bounds = Size;

/** The map rectangle the box floats over. `.reader` is absolute, so its
 *  offset parent is the one positioned element around the map. */
const parentOf = (box: HTMLElement): HTMLElement | null =>
  box.offsetParent instanceof HTMLElement ? box.offsetParent : null;

const boundsOf = (parent: HTMLElement): Bounds => ({
  width: parent.clientWidth,
  height: parent.clientHeight,
});

/** What the box came out at, which under a ceiling is its content and no
 *  more. Both gestures measure rather than trust the stored ceiling. */
const rectOf = (box: HTMLElement, parent: HTMLElement) => {
  const mine = box.getBoundingClientRect();
  const theirs = parent.getBoundingClientRect();
  return {
    left: mine.left - theirs.left,
    top: mine.top - theirs.top,
    width: mine.width,
    height: mine.height,
  };
};

const between = (value: number, least: number, most: number) =>
  Math.min(Math.max(value, least), Math.max(least, most));

/** A corner the box can be grabbed back from: wholly inside the map, given
 *  what it currently measures. */
const inside = (left: number, top: number, size: Size, within: Bounds) => ({
  left: between(left, 0, within.width - size.width),
  top: between(top, 0, within.height - size.height),
});

/** The wall a box has been pushed through, if any, and the hardest one when
 *  it is a corner. Pushing through is the whole gesture: a box at rest keeps
 *  the gutter, so no ordinary nudge can reach a wall by accident. */
const wallCrossed = (
  at: { left: number; top: number },
  size: Size,
  within: Bounds,
): Side | null => {
  const past: Record<Side, number> = {
    left: -at.left,
    top: -at.top,
    right: at.left + size.width - within.width,
    bottom: at.top + size.height - within.height,
  };
  const worst = (Object.keys(past) as Side[]).reduce((a, b) =>
    past[b] > past[a] ? b : a,
  );
  return past[worst] > 0 ? worst : null;
};

/** Flush against one wall, in the shape that wall asks for. A column is
 *  pinned to the top of its side; a bar keeps the run it was dragged to,
 *  because pinning that too would slide it out from under the hand that put
 *  it there. */
const dockedTo = (side: Side, at: { left: number; top: number }): Placement =>
  side === 'left' || side === 'right'
    ? { side, left: GUTTER, top: GUTTER }
    : { side, left: at.left, top: GUTTER };

/** A dock pins the axis it is a wall of; the other keeps its corner. */
const styleOf = (placed: Placement): CSSProperties => ({
  left: placed.side === 'right' ? undefined : placed.left,
  right: placed.side === 'right' ? GUTTER : undefined,
  top: placed.side === 'bottom' ? undefined : placed.top,
  bottom: placed.side === 'bottom' ? GUTTER : undefined,
  maxWidth: placed.maxWidth,
  maxHeight: placed.maxHeight,
});

type Gesture = {
  mode: 'move' | 'resize';
  at: { left: number; top: number };
  /** What the box measured when the press landed. The ceiling may be higher;
   *  it is the pixels on screen that a wall is crossed by and that the grip
   *  is dragged from. */
  size: Size;
  ceiling: Ceiling;
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

  // A window resized under the box leaves it off the map — as does one resized
  // between two readings, hence the pass on mount too. A dock survives it: the
  // wall it names is an anchor, not a number, and the corner a bar keeps along
  // its edge is clamped here with everything else.
  useEffect(() => {
    const onResize = () => {
      const box = boxRef.current;
      const parent = box && parentOf(box);
      if (!box || !parent) return;
      const within = boundsOf(parent);
      const size = rectOf(box, parent);
      setPlacement((was) =>
        was ? { ...was, ...inside(was.left, was.top, size, within) } : null,
      );
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
      const parent = box && parentOf(box);
      if (!box || !parent) return;
      const rect = rectOf(box, parent);
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = {
        mode,
        at: { left: rect.left, top: rect.top },
        size: rect,
        // A ceiling the grip has set is kept across a move; one it has not is
        // not invented here, or a box would freeze at the size the reading it
        // was dragged in happened to need.
        ceiling: {
          maxWidth: placement?.maxWidth,
          maxHeight: placement?.maxHeight,
        },
        within: boundsOf(parent),
        x: event.clientX,
        y: event.clientY,
      };
      // Nothing is written until the pointer actually moves, so a press on the
      // title that turns out to be a click leaves the box as it was. The
      // handover from the layout's CSS costs no jump whenever it happens: what
      // the first move writes is this measurement plus the distance travelled.
    };

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const held = gesture.current;
    if (!held) return;
    const { at, size, ceiling, within } = held;
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;

    if (held.mode === 'resize') {
      // Off the corner the box is actually drawn at, not off the ceiling: the
      // grip is where the hand is, and a ceiling above the content is not.
      setPlacement({
        side: null,
        left: at.left,
        top: at.top,
        maxWidth: between(size.width + dx, MIN_WIDTH, within.width - at.left),
        maxHeight: between(
          size.height + dy,
          MIN_HEIGHT,
          within.height - at.top,
        ),
      });
      return;
    }

    // Unclamped on purpose: a frame pushed through a wall is what asks for the
    // dock, and a docked box is inside the map again, so nothing ever ends up
    // off it.
    const pushed = { left: at.left + dx, top: at.top + dy };
    const side = wallCrossed(pushed, size, within);
    if (!side) {
      setPlacement({ side: null, ...pushed, ...ceiling });
      return;
    }
    // The shape is the dock, as much as the anchor is: switching the layout
    // here rather than on release is what makes the wall a preview of it. Any
    // ceiling the grip had set goes with it — the layout brings its own.
    setLayoutAtom(LAYOUT_OF[side]);
    setPlacement(dockedTo(side, inside(pushed.left, pushed.top, size, within)));
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
    placementStyle: placement ? styleOf(placement) : undefined,
    dragHandle: handlers('move'),
    resizeHandle: handlers('resize'),
  };
};
