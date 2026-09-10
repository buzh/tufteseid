import { atom, useAtomValue, useStore } from 'jotai';
import { useEffect } from 'react';
import { anyOverlayOpenAtom } from '../ui/overlayAtoms';

/*
 * A/D (style), W/S (dataset), E (DTM/DOM) — background cycling from the
 * keyboard. W/S walks whichever ring the active mode has: LiDAR
 * acquisitions in LiDAR mode, ortofoto acquisitions in flyfoto mode. A/D
 * and E are LiDAR-only. docs/ui-architecture.md §5.3.
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

const CYCLE_KEYS: readonly string[] = ['a', 'd', 'w', 's', 'e'];

// A mutable box rather than the handler itself: the handler closes over
// lists that are rebuilt on every render, and putting that in atom state
// would mean a store write per render.
const cycleHandlerRefAtom = atom<{ current: CycleHandler | null }>({
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

/** Mount once, at the shell root. */
export const useBackgroundCyclingKeys = () => {
  const box = useAtomValue(cycleHandlerRefAtom);
  // Read through the store inside the listener rather than subscribing:
  // the value has to be current at keypress time, and subscribing would
  // re-register the listener every time an overlay opens or closes.
  const store = useStore();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // e.repeat: a leaned-on key would otherwise queue a full WMS reload
      // per frame.
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (!CYCLE_KEYS.includes(key)) return;

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

      if (!box.current?.(key as CycleKey)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
    };
  }, [box, store]);
};
