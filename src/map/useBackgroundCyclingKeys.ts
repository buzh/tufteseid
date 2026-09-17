import { atom, useAtomValue, useStore } from 'jotai';
import { useEffect } from 'react';
import { funnSessionAtom } from '../funn/session';
import { funnHiddenAtom } from '../localities/atoms';
import { anyOverlayOpenAtom } from '../ui/overlayAtoms';
import { compareFocusAtom, compareOnAtom } from './compare/halves';
import { infoToolAtom } from './featureInfo/infoTool';

// The map's keyboard layer: 1–5 pick the ground, X peeks at the previous one,
// A/D · W/S · E move within one, and H/I/C are written straight against atoms.
// Which ring W/S and A/D walk is `useGroundMode.cycle`'s decision, not this
// listener's.
//
// The listener must be mounted somewhere that never unmounts — it registers
// with `[]` deps — and there is room for exactly one handler, so a second
// registration silently wins. Capture phase, and handled keys are stopped
// dead: OpenLayers' KeyboardPan is on `document` and ignores defaultPrevented.

export type CycleKey = 'a' | 'd' | 'w' | 's' | 'e';

/** Return true if the key was consumed. */
export type CycleHandler = (key: CycleKey) => boolean;

export type GroundHandler = {
  /** 1-based, matching the digit that was pressed. */
  select: (position: number) => void;
  peekStart: () => void;
  peekEnd: () => void;
};

const CYCLE_KEYS: readonly string[] = ['a', 'd', 'w', 's', 'e'];
// Positional, matching GROUND_MODES in src/shell/useGroundMode.ts.
const GROUND_KEYS: readonly string[] = ['1', '2', '3', '4', '5'];
// Not the backtick: on the Norwegian layout it is a dead key and arrives as
// `key: "Dead"`, which is unusable for hold-and-release.
const PEEK_KEY = 'x';
// The `Funn` group toggle, not the per-funn switches in its pulldown.
const FUNN_KEY = 'h';
const INFO_KEY = 'i';
// Inert while the curtain is down, and deliberately not a way of raising it.
const HALF_KEY = 'c';

// A box rather than atom state: the handler is a fresh closure every render.
const cycleHandlerRefAtom = atom<{ current: CycleHandler | null }>({
  current: null,
});
const groundHandlerRefAtom = atom<{ current: GroundHandler | null }>({
  current: null,
});

/** Publish the cycling behaviour; the handler is withdrawn on unmount. */
export const useRegisterBackgroundCycle = (handler: CycleHandler) => {
  const box = useAtomValue(cycleHandlerRefAtom);
  // No dependency array on purpose: an assignment per render is cheap.
  useEffect(() => {
    box.current = handler;
    return () => {
      if (box.current === handler) box.current = null;
    };
  });
};

/** Same contract, for 1–5 and the peek key. */
export const useRegisterGroundKeys = (handler: GroundHandler) => {
  const box = useAtomValue(groundHandlerRefAtom);
  useEffect(() => {
    box.current = handler;
    return () => {
      if (box.current === handler) box.current = null;
    };
  });
};

/** Mount once, at the shell root. */
export const useBackgroundCyclingKeys = () => {
  const box = useAtomValue(cycleHandlerRefAtom);
  const groundBox = useAtomValue(groundHandlerRefAtom);
  // Read through the store inside the listener rather than subscribing, so an
  // overlay opening or closing does not re-register the listener.
  const store = useStore();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // e.repeat: a leaned-on key would queue a WMS reload per frame, and the
      // autorepeat of a held X must not re-enter peekStart.
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      // The drawing surface takes the whole keyboard, and `inert` on the row
      // does nothing about listeners capture-phase on the document.
      if (store.get(funnSessionAtom)) return;
      const key = event.key.toLowerCase();
      const isCycle = CYCLE_KEYS.includes(key);
      const isGround = GROUND_KEYS.includes(key);
      const isPeek = key === PEEK_KEY;
      const isFunn = key === FUNN_KEY;
      const isInfo = key === INFO_KEY;
      const isHalf = key === HALF_KEY;
      if (!isCycle && !isGround && !isPeek && !isFunn && !isInfo && !isHalf)
        return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
          // An open popover, dialog or select drives its own list, often with
          // letter typeahead these keys would shadow.
          target.closest(
            '[data-scope="popover"], [data-scope="dialog"], [data-scope="select"]',
          ))
      ) {
        return;
      }
      // Focus-independent second check: an overlay that renders without taking
      // focus leaves event.target as the body.
      if (store.get(anyOverlayOpenAtom)) return;

      if (isFunn) {
        store.set(funnHiddenAtom, (prev) => !prev);
      } else if (isInfo) {
        store.set(infoToolAtom, !store.get(infoToolAtom));
      } else if (isHalf) {
        if (!store.get(compareOnAtom)) return;
        store.set(compareFocusAtom, (prev) => (prev === 'a' ? 'b' : 'a'));
      } else if (isCycle) {
        if (!box.current?.(key as CycleKey)) return;
      } else {
        const ground = groundBox.current;
        if (!ground) return;
        if (isPeek) ground.peekStart();
        else ground.select(GROUND_KEYS.indexOf(key) + 1);
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    // Deliberately unguarded: whatever took focus in between, the peek has to
    // end or the map is stranded on a mode nobody chose.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === PEEK_KEY) groundBox.current?.peekEnd();
    };
    // Alt-tabbing away with the key down means the keyup lands somewhere else.
    const onBlur = () => groundBox.current?.peekEnd();

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [box, groundBox, store]);
};
