import { useEffect, useRef } from 'react';

// Keyboard for the open lokalitet, same shape as the LiDAR cycling keys
// in TopBar: one document listener, bail out on modifiers, repeats and
// anything typed into a field.
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
  onEscape: () => void;
  draftActive: boolean;
  // Arrows/Enter walk the funn list. Off when the panel is showing
  // something else (the extract tool), where they mean nothing and the
  // map may as well have them.
  navigable: boolean;
  // Off while a modal owns the keyboard (the Bilder lightbox).
  enabled: boolean;
};

export const useWorkspaceKeys = (handlers: WorkspaceKeyHandlers) => {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const h = ref.current;
      if (!h.enabled) return;

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
  }, []);
};
