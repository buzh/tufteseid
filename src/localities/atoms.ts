import { atom } from 'jotai';
import { LocalityRecord } from '../api/localities';

// The open lokalitet — non-null means the workspace panel is showing and
// the funn layer is hydrated for this record. Holds a snapshot; the
// workspace refreshes it after its own updates.
export const activeLocalityAtom = atom<LocalityRecord | null>(null);

// "Ny lokalitet" armed: the box-drag interaction is live and the next
// drag creates a record (see useLocalityCreate). Cancelled by Escape or
// clicking the TopBar button again.
export const creatingLocalityAtom = atom<boolean>(false);

// A funn is being drawn/edited in the workspace right now. Layout uses
// this to mount the mobile bottom draw toolbar.
export const funnDraftActiveAtom = atom<boolean>(false);

// "Juster området": the open lokalitet's rectangle is move/resizable on
// a temp layer (see useLocalityAdjust). Mutually exclusive with the
// funn draft — the workspace enforces that.
export const adjustingLocalityAtom = atom<boolean>(false);

// Which funn the list is pointing at. `hovered` is transient (pointer or
// keyboard cursor), `selected` sticks until another row is picked or the
// list is dismissed. Both drive the halo drawn by funnHighlightLayer —
// the funn features themselves keep the style they were drawn with, so
// the emphasis has to live on a layer of its own.
export const hoveredFunnIdAtom = atom<string | null>(null);
export const selectedFunnIdAtom = atom<string | null>(null);

// Which workspace sections are expanded. Outside the component because
// LocalityWorkspace is keyed by locality.id and remounts on every swap —
// folding "Detaljer" away should stay folded for the next lokalitet too.
export type WorkspaceSectionId =
  | 'funn'
  | 'bilder'
  | 'kulturminner'
  | 'detaljer';

export const openSectionsAtom = atom<Set<WorkspaceSectionId>>(
  new Set<WorkspaceSectionId>(['funn', 'bilder']),
);

// The Bilder lightbox owns the arrow keys while it is up. Lifted out of
// BilderSection so the workspace's own keyboard layer can stand down
// instead of both reacting to the same press.
export const lightboxOpenAtom = atom<boolean>(false);
