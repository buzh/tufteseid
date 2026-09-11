import { atom } from 'jotai';
import { LocalityRecord } from '../api/localities';
import type { TerrainSpec } from './viewSpec';

// The open lokalitet — non-null means the workspace panel is showing and
// the funn layer is hydrated for this record. Holds a snapshot; the
// workspace refreshes it after its own updates.
export const activeLocalityAtom = atom<LocalityRecord | null>(null);

// Which lokalitet is open in *edit* rather than in show — the second axis
// (docs/lokalitet-view.md §1). Nothing in show writes, so this is the atom
// every write verb in the lokalitet surfaces is ultimately gated on.
//
// A record id rather than a boolean, and that is the whole trick: "opening a
// lokalitet lands in show" (§3) then holds *by construction* rather than by
// somebody remembering to clear a flag in the right order. A brand-new
// lokalitet is the one exception, and its creators say so by setting this
// alongside `activeLocalityAtom` — the two writes are one batch, so the
// workspace never renders the record in show first.
export const editingLocalityIdAtom = atom<string | null>(null);

// The view behind the open lokalitet's cover terrain render, if it has one.
// Published by the workspace (which is what holds the attachment list) and
// read by `useTerrainAnalysis`, which is mounted on the other side of the
// tree and seeds its knobs from it — docs/lokalitet-view.md §4.6.
export const coverTerrainSpecAtom = atom<TerrainSpec | null>(null);

// A funn is being drawn/edited in the workspace right now. The shell
// uses this to mount the mobile bottom draw toolbar.
export const funnDraftActiveAtom = atom<boolean>(false);

// "Juster området": the open lokalitet's rectangle is move/resizable on
// a temp layer (see useLocalityAdjust). Mutually exclusive with the
// funn draft — the workspace enforces that.
export const adjustingLocalityAtom = atom<boolean>(false);

// Which funn the list is pointing at. `hovered` is transient (pointer or
// keyboard cursor), `selected` sticks until another row is picked or the
// list is dismissed. Both drive the halo in funnHighlightLayer, which
// explains why that's a separate layer.
export const hoveredFunnIdAtom = atom<string | null>(null);
export const selectedFunnIdAtom = atom<string | null>(null);

// Take everything *we* drew off the map for a moment — the funn, their
// selection halo and the lokalitet rectangles. Comparing two acquisitions of
// the same ground means looking at the ground, and a cased outline sitting
// exactly on the bump you are trying to judge is the one thing guaranteed to
// be in the way of judging it.
//
// Not persisted to the URL: it is a glance, like the ground peek, and a link
// shared to show someone a funn must not arrive with the funn hidden.
export const marksHiddenAtom = atom(false);

// Which dock sections are expanded. Outside the component because the dock
// is keyed by locality.id and remounts on every swap — folding "Detaljer"
// away should stay folded for the next lokalitet too.
//
// `bilder` is no longer among them: the images left the dock for the bottom
// edge (docs/lokalitet-view.md §4.3), and whether that edge is unfolded is
// `bilderStripOpenAtom` in toolAtoms.ts — a different question from which
// section of a column is expanded, and it outlives this set.
export type WorkspaceSectionId = 'funn' | 'kulturminner' | 'detaljer';

export const openSectionsAtom = atom<Set<WorkspaceSectionId>>(
  new Set<WorkspaceSectionId>(['funn']),
);

// Which bilde is pinned to the map ("Vis i ruta"), if any. Outside the
// filmstrip because the strip is collapsible and unmounts when it is folded
// away — and folding it away to look at the map is exactly what you do after
// pinning something. usePinnedBilde, mounted from the workspace, is what
// turns this into pixels.
export const pinnedAttachmentIdAtom = atom<string | null>(null);
