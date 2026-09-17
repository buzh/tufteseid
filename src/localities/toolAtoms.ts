import { atom } from 'jotai';
import { funnDraftActiveAtom } from './atoms';

// Which tool surface the workspace is showing. Drawing is not a member — the
// session answers that through `funnDraftActiveAtom`; `workspaceModeAtom`
// combines the two.
export type RibbonTool = 'lidar' | 'terrain' | null;

export const ribbonToolAtom = atom<RibbonTool>(null);

// Derived rather than stored, so it cannot disagree with the two flags it
// reads.
export type WorkspaceMode = 'draft' | 'lidar' | 'terrain' | 'browse';

export const workspaceModeAtom = atom<WorkspaceMode>((get) =>
  get(funnDraftActiveAtom) ? 'draft' : (get(ribbonToolAtom) ?? 'browse'),
);

// An atom because the trigger (`⋮` on the lokalitet row) and the dialog
// (`LocalityDialogs`) are in different subtrees.
export const localityDetailsOpenAtom = atom(false);

// Whether the bottom edge is unfolded. Module-level so the fold survives
// changing lokalitet; open by default.
export const bilderStripOpenAtom = atom(true);

// The drawing in progress sticks out of the lokalitet's rectangle. A flag
// rather than the union bbox: this is written while the pen is moving, and the
// union is recomputed from the draw layer when "Utvid området" is pressed.
export const funnOutsideAtom = atom(false);
