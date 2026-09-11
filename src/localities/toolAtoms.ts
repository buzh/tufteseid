import { atom } from 'jotai';
import { funnDraftActiveAtom } from './atoms';

// Which tool surface the workspace is showing. Drawing is deliberately not
// a member: it already has funnDraftActiveAtom, which the shell reads to
// mount the mobile draw toolbar, and a second flag for the same state would
// drift. Ask workspaceModeAtom for the combined answer.
export type RibbonTool = 'lidar' | 'terrain' | null;

export const ribbonToolAtom = atom<RibbonTool>(null);

// The four states the workspace body can be in. Drawing a funn, running an
// extract and reading terrain each take the surface over; everything else
// is browsing. Derived rather than stored so it cannot disagree with the
// two flags it reads.
export type WorkspaceMode = 'draft' | 'lidar' | 'terrain' | 'browse';

export const workspaceModeAtom = atom<WorkspaceMode>((get) =>
  get(funnDraftActiveAtom) ? 'draft' : (get(ribbonToolAtom) ?? 'browse'),
);

// Whether the lokalitet dock is unfolded. Module-level rather than component
// state so folding it away to look at the map survives closing and reopening
// a lokalitet — the one gesture you make precisely because you want the map,
// undone by the next thing you open, would be worse than no fold at all.
export const dockOpenAtom = atom(true);

// Whether the bottom edge is unfolded — docs/lokalitet-view.md §4.3. Module
// level for the same reason as `dockOpenAtom`: this one takes a slice of the
// map's *height*, so folding it away is a gesture made in order to see the
// ground, and having the next lokalitet undo it would be worse than having no
// fold at all.
//
// Open by default, unlike a tool: the images are the lokalitet's content now,
// not a panel about it. The row's `Bilder ▾` is what puts it back.
export const bilderStripOpenAtom = atom(true);

// The drawing in progress sticks out of the lokalitet's rectangle.
//
// A flag, not the union bbox it used to hold: this is read while the pen is
// moving, and re-publishing a rectangle that grows with every frame of a drag
// would re-render the dock on every frame to say the same thing. The union is
// cheap to recompute from the draw layer at the moment "Utvid området" is
// pressed, and computing it there means it can't go stale.
export const funnOutsideAtom = atom(false);
