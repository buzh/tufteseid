

import { atom, useAtom } from 'jotai';
import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { uiScaleFactor } from './uiScale';

export type PanelLayout = 'wide' | 'tall';

type Side = 'left' | 'right' | 'top' | 'bottom';

type Size = { width: number; height: number };

type Ceiling = { maxWidth?: number; maxHeight?: number };

type Placement = Ceiling & {

  side: Side | null;

  left: number;
  top: number;
};

const panelLayoutAtom = atom<PanelLayout>('wide');

const panelPlacementAtom = atom<Placement | null>(null);

const MIN_WIDTH = 260;
const MIN_HEIGHT = 140;

const GUTTER = 10;

const scaled = (px: number) => px * uiScaleFactor();

const LAYOUT_OF: Record<Side, PanelLayout> = {
  left: 'tall',
  right: 'tall',
  top: 'wide',
  bottom: 'wide',
};

const parentOf = (box: HTMLElement): HTMLElement | null =>
  box.offsetParent instanceof HTMLElement ? box.offsetParent : null;

const boundsOf = (parent: HTMLElement): Size => ({
  width: parent.clientWidth,
  height: parent.clientHeight,
});

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

const inside = (left: number, top: number, size: Size, within: Size) => ({
  left: between(left, 0, within.width - size.width),
  top: between(top, 0, within.height - size.height),
});

const wallCrossed = (
  at: { left: number; top: number },
  size: Size,
  within: Size,
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

const dockedTo = (side: Side, at: { left: number; top: number }): Placement =>
  side === 'left' || side === 'right'
    ? { side, left: scaled(GUTTER), top: scaled(GUTTER) }
    : { side, left: at.left, top: scaled(GUTTER) };

const styleOf = (placed: Placement): CSSProperties => ({
  left: placed.side === 'right' ? undefined : placed.left,
  right: placed.side === 'right' ? scaled(GUTTER) : undefined,
  top: placed.side === 'bottom' ? undefined : placed.top,
  bottom: placed.side === 'bottom' ? scaled(GUTTER) : undefined,
  maxWidth: placed.maxWidth,
  maxHeight: placed.maxHeight,
});

type Gesture = {
  mode: 'move' | 'resize';
  at: { left: number; top: number };

  size: Size;
  ceiling: Ceiling;
  within: Size;
  x: number;
  y: number;
};

export const useFloatingPanel = () => {
  const [layout, setLayoutAtom] = useAtom(panelLayoutAtom);
  const [placement, setPlacement] = useAtom(panelPlacementAtom);
  const boxRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);

  const setLayout = useCallback(
    (next: PanelLayout) => {
      setLayoutAtom(next);
      setPlacement(null);
    },
    [setLayoutAtom, setPlacement],
  );

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

      if (!event.isPrimary || event.button !== 0) return;

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

        ceiling: {
          maxWidth: placement?.maxWidth,
          maxHeight: placement?.maxHeight,
        },
        within: boundsOf(parent),
        x: event.clientX,
        y: event.clientY,
      };

    };

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const held = gesture.current;
    if (!held) return;
    const { at, size, ceiling, within } = held;
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;

    if (held.mode === 'resize') {

      setPlacement({
        side: null,
        left: at.left,
        top: at.top,
        maxWidth: between(
          size.width + dx,
          scaled(MIN_WIDTH),
          within.width - at.left,
        ),
        maxHeight: between(
          size.height + dy,
          scaled(MIN_HEIGHT),
          within.height - at.top,
        ),
      });
      return;
    }

    const pushed = { left: at.left + dx, top: at.top + dy };
    const side = wallCrossed(pushed, size, within);
    if (!side) {
      setPlacement({ side: null, ...pushed, ...ceiling });
      return;
    }

    setLayoutAtom(LAYOUT_OF[side]);
    setPlacement(dockedTo(side, inside(pushed.left, pushed.top, size, within)));
  };

  const end = (event: ReactPointerEvent<HTMLElement>) => {

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

    placed: placement !== null,
    placementStyle: placement ? styleOf(placement) : undefined,
    dragHandle: handlers('move'),
    resizeHandle: handlers('resize'),
  };
};
