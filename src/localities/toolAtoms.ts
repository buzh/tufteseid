import { atom } from 'jotai';
import type { LocalityBbox } from '../api/localities';
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

// Pending bbox for the grow-to-fit prompt; non-null means the modal is up.
// An atom rather than component state because the keyboard layer has to
// stand down while it shows, and once the panel is split into ribbon rows
// the modal and that layer no longer share a component.
export const growPromptAtom = atom<LocalityBbox | null>(null);
