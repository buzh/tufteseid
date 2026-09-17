import { atom } from 'jotai';
import { LocalityRecord } from '../api/localities';
import { funnSessionAtom } from '../funn/session';
import type { TerrainSpec } from './viewSpec';

// Non-null means the workspace is up and the funn layer is hydrated for this
// record. A snapshot, refreshed by the workspace after its own updates.
export const activeLocalityAtom = atom<LocalityRecord | null>(null);

// Which lokalitet is open in edit. A record id rather than a boolean, so
// opening another one lands in show without anybody clearing a flag.
export const editingLocalityIdAtom = atom<string | null>(null);

// Set where a lokalitet is created, cleared when the workspace starts the
// fetch, so the starter set never arrives on a revisit.
export const pendingStarterLocalityIdAtom = atom<string | null>(null);

// Published by the workspace, read by `useTerrainAnalysis` to seed its knobs.
export const coverTerrainSpecAtom = atom<TerrainSpec | null>(null);

// Derived from the drawing session rather than held beside it. A sketch is the
// same surface but not a funn draft.
export const funnDraftActiveAtom = atom(
  (get) => get(funnSessionAtom)?.mode === 'funn',
);

// "Juster området"; the workspace keeps it exclusive with the funn draft.
export const adjustingLocalityAtom = atom<boolean>(false);

// `hovered` is transient, `selected` sticks. Both drive the halo.
export const hoveredFunnIdAtom = atom<string | null>(null);
export const selectedFunnIdAtom = atom<string | null>(null);

// Drawings, halo and callout off the map. Not persisted to the URL: a shared
// link must not arrive with the funn hidden.
export const funnHiddenAtom = atom(false);

// The `[Funn ▾]` switches, as the ids that are *off*. Separate from the flag
// above, so putting the group back restores the members that were on.
export const funnSwitchedOffAtom = atom<ReadonlySet<string>>(
  new Set<string>(),
);
