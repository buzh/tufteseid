

export type CursorLease = {

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
