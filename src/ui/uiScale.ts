import { atom } from 'jotai';

const UI_SCALES = ['small', 'large'] as const;

export type UiScale = (typeof UI_SCALES)[number];

const STORAGE_KEY = 'uiScale.v1';

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

const paint = (scale: UiScale) => {
  document.documentElement.dataset.uiScale = scale;
};

export const applyStoredUiScale = () => paint(initial);

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

    }
  },
);
