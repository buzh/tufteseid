import { atom, useAtomValue } from 'jotai';

export const TYPING_SURFACE = 'input, textarea, [contenteditable="true"]';

const HINT_IDS = [
  'heritageKey',
  'sketchKey',
  'pictureKeys',
  'keepPicture',
] as const;

export type HintId = (typeof HINT_IDS)[number];

const STORAGE_KEY = 'hintsDismissed.v1';

const isHintId = (value: unknown): value is HintId =>
  typeof value === 'string' && (HINT_IDS as readonly string[]).includes(value);

const stored = (): HintId[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isHintId) : [];
  } catch {
    return [];
  }
};

const dismissedAtom = atom<HintId[]>(stored());

const closedAtom = atom<HintId[]>([]);

export const useHintOpen = (id: HintId) => {
  const dismissed = useAtomValue(dismissedAtom);
  const closed = useAtomValue(closedAtom);
  return !dismissed.includes(id) && !closed.includes(id);
};

export const closeHintAtom = atom(
  null,
  (get, set, id: HintId, forever: boolean) => {
    set(closedAtom, [...new Set([...get(closedAtom), id])]);
    if (!forever) return;
    const kept = [...new Set([...get(dismissedAtom), id])];
    set(dismissedAtom, kept);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
    } catch {

    }
  },
);
