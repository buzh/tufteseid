// Several pointer handlers write the viewport cursor at once; a lease only
// clears it if it set it.

export type CursorLease = {
  /** Show `cursor`, or release the viewport when it is null. */
  set: (cursor: string | null) => void;
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
