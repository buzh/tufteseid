import { atom, useAtomValue, useStore } from 'jotai';
import { useEffect } from 'react';
import { anyOverlayOpenAtom } from '../ui/overlayAtoms';

/*
 * The map's keyboard layer: which ground you are on, and which variant of it.
 *
 * 1–5 pick the ground mode outright (Standard, LiDAR, Hybrid, Flyfoto,
 * Terreng) and holding X peeks at the one you were on before, snapping back
 * on release — reading relief against a photograph means flipping between
 * them dozens of times, and a hold-to-compare is the cheapest form of that.
 *
 * A/D (style), W/S (dataset), E (DTM/DOM) then move *within* a mode. W/S
 * walks whichever ring the active mode has: LiDAR acquisitions in LiDAR mode,
 * ortofoto acquisitions in flyfoto mode. A/D and E are LiDAR-only.
 * docs/ui-architecture.md §5.3.
 *
 * Split into a listener and a registration so the two halves can live in
 * different components. The listener has to be mounted somewhere that never
 * unmounts: it registers with `[]` deps, so a host that comes and goes (a
 * ribbon row that collapses, say) would re-register and flip its position in
 * the capture chain relative to the other keyboard layers. The handler, on
 * the other hand, closes over the state of whichever pulldown the keys are
 * walking, and belongs with whatever renders that.
 *
 * Exactly one handler at a time, so a mode with its own ring composes rather
 * than registers: each half declines every key outside its own mode, and the
 * ribbon chains them. Two registrations would silently mean the last one
 * mounted wins.
 *
 * Capture phase, and handled keys are stopped dead — the same treatment
 * useWorkspaceKeys and LidarExtractViewer already give theirs. OpenLayers'
 * KeyboardPan is attached to `document` (see the map atom's
 * keyboardEventTarget) and ignores defaultPrevented.
 */

export type CycleKey = 'a' | 'd' | 'w' | 's' | 'e';

/** Return true if the key was consumed. */
export type CycleHandler = (key: CycleKey) => boolean;

/** Ground-mode selection and the hold-to-compare peek. */
export type GroundHandler = {
  /** 1-based, matching the digit that was pressed. */
  select: (position: number) => void;
  peekStart: () => void;
  peekEnd: () => void;
};

const CYCLE_KEYS: readonly string[] = ['a', 'd', 'w', 's', 'e'];
// Positional, so the digits and the mode buttons stay in step by
// construction — see GROUND_MODES in src/shell/useGroundMode.ts.
const GROUND_KEYS: readonly string[] = ['1', '2', '3', '4', '5'];
// Not the backtick: on the Norwegian layout it is a dead key and arrives as
// `key: "Dead"`, which is unusable for hold-and-release.
const PEEK_KEY = 'x';

// A mutable box rather than the handler itself: the handler closes over
// lists that are rebuilt on every render, and putting that in atom state
// would mean a store write per render.
const cycleHandlerRefAtom = atom<{ current: CycleHandler | null }>({
  current: null,
});
const groundHandlerRefAtom = atom<{ current: GroundHandler | null }>({
  current: null,
});

/**
 * Publish the cycling behaviour. Safe to call from a component that
 * unmounts — the handler is withdrawn on the way out.
 */
export const useRegisterBackgroundCycle = (handler: CycleHandler) => {
  const box = useAtomValue(cycleHandlerRefAtom);
  // No dependency array on purpose: `handler` is a fresh closure every
  // render and an assignment is cheap, unlike re-attaching a listener.
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
  // Read through the store inside the listener rather than subscribing:
  // the value has to be current at keypress time, and subscribing would
  // re-register the listener every time an overlay opens or closes.
  const store = useStore();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // e.repeat: a leaned-on key would otherwise queue a full WMS reload
      // per frame. It is also what makes the peek a *hold* — the autorepeat
      // of a held X must not re-enter peekStart.
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      const isCycle = CYCLE_KEYS.includes(key);
      const isGround = GROUND_KEYS.includes(key);
      const isPeek = key === PEEK_KEY;
      if (!isCycle && !isGround && !isPeek) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
          // An open popover, dialog or select is driving its own list —
          // often with letter typeahead, which these keys would otherwise
          // shadow while also swapping the map behind it.
          target.closest(
            '[data-scope="popover"], [data-scope="dialog"], [data-scope="select"]',
          ))
      ) {
        return;
      }
      // Second, focus-independent check on the same question. A future
      // overlay primitive that renders without taking focus would leave
      // event.target === document.body and slip past the walk above.
      if (store.get(anyOverlayOpenAtom)) return;

      if (isCycle) {
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

    // Release is not guarded the way the press is: whatever happened in
    // between — a field taking focus, a dialog opening — the peek has to end,
    // or the map is stranded on a mode nobody chose. peekEnd is a no-op when
    // no peek is running, which is what makes that safe.
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
