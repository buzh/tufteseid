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

/** `wide` is a bar along the bottom, `tall` a column down the side. */
export type ReaderLayout = 'wide' | 'tall';

type Frame = { left: number; top: number; width: number; height: number };

export const readerLayoutAtom = atom<ReaderLayout>('wide');

/** Null until the box has been moved or resized: until then the layout's own
 *  CSS places it, so a reading opens where the layout says it should. */
const readerFrameAtom = atom<Frame | null>(null);

const MIN_WIDTH = 260;
const MIN_HEIGHT = 140;

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

type Gesture = {
  mode: 'move' | 'resize';
  from: Frame;
  within: Bounds;
  x: number;
  y: number;
};

export const useReaderWindow = () => {
  const [layout, setLayoutAtom] = useAtom(readerLayoutAtom);
  const [frame, setFrame] = useAtom(readerFrameAtom);
  const boxRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);

  // Choosing a layout is also the way back: a box dragged somewhere unhelpful
  // is put right by asking for the shape it should have had.
  const setLayout = useCallback(
    (next: ReaderLayout) => {
      setLayoutAtom(next);
      setFrame(null);
    },
    [setLayoutAtom, setFrame],
  );

  // A window narrowed under a placed box would leave it off the map — as
  // would one narrowed between two readings, hence the pass on mount too.
  useEffect(() => {
    const onResize = () => {
      const box = boxRef.current;
      const within = box && boundsOf(box);
      if (within) setFrame((was) => (was ? clamped(was, within) : null));
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setFrame]);

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
      // move, or the box jumps by whatever the two disagree about.
      setFrame(clamped(from, within));
    };

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const held = gesture.current;
    if (!held) return;
    const { from, within } = held;
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;
    setFrame(
      clamped(
        held.mode === 'move'
          ? { ...from, left: from.left + dx, top: from.top + dy }
          : {
              ...from,
              // Capped against the corner it is dragged from, not the map, or
              // growing past the edge would shove the box sideways.
              width: Math.min(from.width + dx, within.width - from.left),
              height: Math.min(from.height + dy, within.height - from.top),
            },
        within,
      ),
    );
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
    /** Moved or resized, so the layout's anchor no longer applies. */
    placed: frame !== null,
    frameStyle: frame ?? undefined,
    dragHandle: handlers('move'),
    resizeHandle: handlers('resize'),
  };
};
