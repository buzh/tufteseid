import { atom } from 'jotai';

const UI_SCALES = ['small', 'large'] as const;

export type UiScale = (typeof UI_SCALES)[number];

const STORAGE_KEY = 'uiScale.v1';

// The store is reader-editable, so anything but a known name is the default.
const stored = (): UiScale => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return (UI_SCALES as readonly string[]).includes(raw ?? '')
      ? (raw as UiScale)
      : 'small';
  } catch {
    return 'small';
  }
};

const initial = stored();

// What `:root[data-ui-scale='large']` in `src/index.css` answers to.
const paint = (scale: UiScale) => {
  document.documentElement.dataset.uiScale = scale;
};

/** Before the first paint, or the band is drawn small and then jumps. */
export const applyStoredUiScale = () => paint(initial);

/** The factor as a plain number, for geometry that cannot be written as CSS.
 *  Off the attribute rather than the atom, so a caller needs no subscriber;
 *  the 2 is `--ui-scale` in `src/index.css`. Read where it is needed, nothing
 *  re-runs on a change. */
export const uiScaleFactor = () =>
  document.documentElement.dataset.uiScale === 'large' ? 2 : 1;

const scaleAtom = atom<UiScale>(initial);

export const uiScaleAtom = atom(
  (get) => get(scaleAtom),
  (_get, set, next: UiScale) => {
    set(scaleAtom, next);
    paint(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Quota or unavailable storage: the choice lasts this page load.
    }
  },
);
