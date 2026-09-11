import { useStore } from 'jotai';
import { useEffect, useRef } from 'react';
import { anyOverlayOpenAtom } from '../ui/overlayAtoms';

// Keyboard for the open lokalitet, same shape as the background cycling keys
// in src/map/useBackgroundCyclingKeys.ts: one document listener, bail out on
// modifiers, repeats, anything typed into a field, and anything with an
// overlay open over it.
//
// Capture phase, and handled keys are stopped dead. OpenLayers'
// KeyboardPan is attached to `document` too (see the map atom's
// keyboardEventTarget) and does not look at defaultPrevented, so a
// bubble-phase listener would move the funn selection *and* pan the map
// out from under it. LidarExtractViewer does the same thing for the same
// reason.
//
// Escape is deliberately NOT bound while a funn draft is open —
// DrawControls binds it to abort the shape currently being sketched, and
// stealing it there would throw away a drawing instead of a keystroke.

export type WorkspaceKeyHandlers = {
  onNewFunn: () => void;
  onToggleLidar: () => void;
  onScreenshot: () => void;
  onMoveSelection: (delta: 1 | -1) => void;
  onZoomSelected: () => void;
  onStepBilde: (delta: 1 | -1) => void;
  onEscape: () => void;
  draftActive: boolean;
  // Arrows/Enter walk the funn list. The list is always on screen in the
  // dock, so this stays on while the extract and terrain panels are open —
  // it is off only while drawing, where picking a different funn out from
  // under the pen is never what the arrow meant.
  navigable: boolean;
  // ←/→ walk the filmstrip. Off unless there is a strip with something in it:
  // OpenLayers' KeyboardPan owns these keys otherwise (↑/↓ it has already
  // lost to the funn list), and taking horizontal panning away from a map
  // whose bottom edge is folded away would be a straight loss.
  stripNavigable: boolean;
};

export const useWorkspaceKeys = (handlers: WorkspaceKeyHandlers) => {
  const ref = useRef(handlers);
  ref.current = handlers;
  // Read through the store inside the listener: the value must be current
  // at keypress time, and subscribing would re-register on every open.
  const store = useStore();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const h = ref.current;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
          // An open popover/dialog/select drives its own list with the
          // same keys; don't move the funn selection out from under it.
          target.closest(
            '[data-scope="popover"], [data-scope="dialog"], [data-scope="select"]',
          ))
      ) {
        return;
      }
      // Second, focus-independent check on the same question — see
      // src/ui/overlayAtoms.ts.
      if (store.get(anyOverlayOpenAtom)) return;

      let handled = true;
      switch (event.key) {
        case 'ArrowDown':
          if (h.navigable) h.onMoveSelection(1);
          else handled = false;
          break;
        case 'ArrowUp':
          if (h.navigable) h.onMoveSelection(-1);
          else handled = false;
          break;
        case 'ArrowRight':
          if (h.stripNavigable) h.onStepBilde(1);
          else handled = false;
          break;
        case 'ArrowLeft':
          if (h.stripNavigable) h.onStepBilde(-1);
          else handled = false;
          break;
        case 'Enter':
          if (h.navigable) h.onZoomSelected();
          else handled = false;
          break;
        case 'Escape':
          if (h.draftActive) handled = false;
          else h.onEscape();
          break;
        default:
          switch (event.key.toLowerCase()) {
            case 'n':
              h.onNewFunn();
              break;
            case 'u':
              h.onToggleLidar();
              break;
            case 'b':
              h.onScreenshot();
              break;
            default:
              handled = false;
          }
      }

      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
    };
  }, [store]);
};
