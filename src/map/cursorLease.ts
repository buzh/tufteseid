// The viewport cursor, lent out rather than written over.
//
// Three things point at the same property and are deliberately allowed to be
// live at once: the terrain rectangle (`terrain/windowAdjust.ts`), the pin being
// placed (`spots/pinAdjust.ts`) and the Kulturminner hover
// (`heritageInfo/useHeritageInfo.ts`). Each of them runs on every pointer move,
// so the one that means "nothing of mine here" was clearing whatever the others
// had just set — hovering a corner handle with a draft open got its resize
// glyph erased by the pin, or kept, depending on which interaction OpenLayers
// reached first.
//
// A lease only clears what it set. Two of them claiming the pointer at the same
// pixel is still last-writer-wins, and that is fine: they are pointing at the
// same thing.

export type CursorLease = {
  /** Show `cursor`, or give the viewport back when it is null. */
  set: (cursor: string | null) => void;
  /** Give it back. For an effect's cleanup. */
  release: () => void;
};

export const cursorLease = (viewport: HTMLElement): CursorLease => {
  let held = false;

  const set = (cursor: string | null) => {
    if (cursor) {
      viewport.style.cursor = cursor;
      held = true;
      return;
    }
    if (!held) return;
    viewport.style.cursor = '';
    held = false;
  };

  return { set, release: () => set(null) };
};
