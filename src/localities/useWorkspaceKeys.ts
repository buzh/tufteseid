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
// out from under it.
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
  // A picker run is up (docs/lokalitet-view.md §4.3) — depth 2 in §5.3's
  // table, and it owns the keyboard outright while it lasts.
  pickerActive: boolean;
  onPickerStep: (delta: 1 | -1) => void;
  onPickerKeep: () => void;
  onPickerDiscard: () => void;
  onPickerFinish: () => void;
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

      /*
       * A live picker run takes the whole keyboard.
       *
       * Not a layer *on top of* the others — a replacement for them. ←/→ are
       * walking proposals rather than the filmstrip; `N`, `U` and `B` would
       * start a second thing on a surface whose entire job is one decision at
       * a time; and `Esc` ends the run rather than the stance behind it,
       * which is what makes it the deepest thing in flight (§5.3).
       *
       * Enter/K keep and Delete/X discard, two spellings each, because one
       * hand on the arrows should be able to finish the job.
       */
      if (h.pickerActive) {
        switch (event.key) {
          case 'ArrowRight':
            h.onPickerStep(1);
            break;
          case 'ArrowLeft':
            h.onPickerStep(-1);
            break;
          case 'Enter':
            h.onPickerKeep();
            break;
          case 'Delete':
            h.onPickerDiscard();
            break;
          case 'Escape':
            h.onPickerFinish();
            break;
          default:
            switch (event.key.toLowerCase()) {
              case 'k':
                h.onPickerKeep();
                break;
              case 'x':
                h.onPickerDiscard();
                break;
              default:
                return;
            }
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

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
