import { atom } from 'jotai';
import { LocalityRecord } from '../api/localities';
import { funnSessionAtom } from '../funn/session';
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

/*
 * A funn is being drawn or edited in the workspace right now.
 *
 * Derived from the drawing session rather than held, since the pen became one
 * surface with two modes (`funn/session.ts`). It used to be a flag the
 * workspace set on the way in and cleared on the way out, and a flag beside
 * the session is a flag that can disagree with it — "the draft band is up but
 * the canvas never opened" is precisely the state a frame capture can fail
 * into. So the question is asked of the session, which is the thing that
 * either exists or does not.
 *
 * A *sketch* session is not a funn draft: same surface, different thing being
 * made, and the draft band, the autosave and `workspaceModeAtom`'s 'draft' all
 * belong to the funn arm alone.
 */
export const funnDraftActiveAtom = atom(
  (get) => get(funnSessionAtom)?.mode === 'funn',
);

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

// And one funn at a time — the per-member switches in `[Funn]`'s pulldown
// (docs/lokalitet-view.md §13.10 step 4). Ids that are *off*, so the default
// is every funn on the map and an id nobody has touched needs no entry.
//
// Separate from the flag above rather than derived from it, for the reason
// `sketchGroupShownAtom` is separate from `sketchShownAtom`: taking the group
// off and putting it back has to restore the reading that was up, and the
// members' own switches are what remember it.
//
// Keyed by record id, so it belongs to the open lokalitet and the workspace
// empties it on the way out. Not persisted anywhere, like the flag: this is
// what I am looking at now, which §13.8 is firm is not the same statement as
// `hidden`, which is curation.
export const funnSwitchedOffAtom = atom<ReadonlySet<string>>(
  new Set<string>(),
);
