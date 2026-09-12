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

// A lokalitet made moments ago that has not been given its starter set yet —
// the best LiDAR dataset over its rectangle, read three ways
// (docs/lokalitet-view.md §4.3).
//
// Set by the two places that create one and open it, cleared by the workspace
// when it starts the fetch, so the set arrives once and never on a lokalitet
// being revisited. An id rather than a boolean for the same reason
// `editingLocalityIdAtom` is: it cannot survive into the wrong record.
//
// Why a hand-off atom at all, rather than the workspace noticing an empty
// gallery: "no bilder yet" is also true of a lokalitet somebody deliberately
// emptied, and fetching three images into it every time they open it is the
// one behaviour worse than not fetching them at all.
export const pendingStarterLocalityIdAtom = atom<string | null>(null);

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

// Take the funn off the map for a moment — the drawings, their selection halo
// and the callout that annotates them. Comparing two acquisitions of the same
// ground means looking at the ground, and a cased outline sitting exactly on
// the bump you are trying to judge is the one thing guaranteed to be in the
// way of judging it.
//
// The lokalitet rectangles used to go with them, under one "Skjul merker" on
// row 1. They no longer do, and there is no switch for them at all: a
// rectangle that is not the open one now draws faint (localityLayer.ts), which
// answers the same complaint — it says a lokalitet is here without covering
// the ground it frames — without a control to find. What is left is exactly
// the set of things `Funn` lists, which is why the switch is a segment of
// that button, beside the count of what it hides.
//
// Not persisted to the URL: it is a glance, like the ground peek, and a link
// shared to show someone a funn must not arrive with the funn hidden.
export const funnHiddenAtom = atom(false);

// Which bilde is pinned to the map ("Vis i ruta"), if any. Outside the
// filmstrip because the strip is collapsible and unmounts when it is folded
// away — and folding it away to look at the map is exactly what you do after
// pinning something. usePinnedBilde, mounted from the workspace, is what
// turns this into pixels.
export const pinnedAttachmentIdAtom = atom<string | null>(null);
