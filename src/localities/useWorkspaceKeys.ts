import { useStore } from 'jotai';
import { useEffect, useRef } from 'react';
import { funnSessionAtom } from '../funn/session';
import { anyOverlayOpenAtom } from '../ui/overlayAtoms';

// One document listener, bailing out on modifiers, repeats, typing and
// overlays. Capture phase, and handled keys are stopped dead: KeyboardPan is on
// `document` too and ignores defaultPrevented. Escape stays unbound while the
// pen is down, Excalidraw having bound it to abort the shape.

export type WorkspaceKeyHandlers = {
  onNewFunn: () => void;
  onToggleLidar: () => void;
  onScreenshot: () => void;
  onMoveSelection: (delta: 1 | -1) => void;
  onZoomSelected: () => void;
  onStepBilde: (delta: 1 | -1) => void;
  onEscape: () => void;
  // A picker run owns the keyboard outright while it lasts.
  pickerActive: boolean;
  onPickerStep: (delta: 1 | -1) => void;
  onPickerKeep: () => void;
  onPickerDiscard: () => void;
  onPickerFinish: () => void;
  draftActive: boolean;
  // Arrows/Enter walk the funn whatever is open, except while drawing.
  navigable: boolean;
  // ←/→ walk the filmstrip, but only when there is one: KeyboardPan keeps
  // horizontal panning otherwise.
  stripNavigable: boolean;
};

export const useWorkspaceKeys = (handlers: WorkspaceKeyHandlers) => {
  const ref = useRef(handlers);
  ref.current = handlers;
  // Read through the store: subscribing would re-register on every open.
  const store = useStore();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      // While the pen is down the drawing surface owns the keyboard.
      if (store.get(funnSessionAtom)) return;
      const h = ref.current;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
          // An open popover drives its own list with the same keys.
          target.closest(
            '[data-scope="popover"], [data-scope="dialog"], [data-scope="select"]',
          ))
      ) {
        return;
      }
      // Second, focus-independent check on the same question.
      if (store.get(anyOverlayOpenAtom)) return;

      // A run replaces the keyboard rather than layering on it: Esc ends the
      // run and not the stance, and keep/discard have two spellings each.
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
