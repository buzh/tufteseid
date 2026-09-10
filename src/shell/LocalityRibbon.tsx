import { useAtomValue } from 'jotai';
import { createPortal } from 'react-dom';
import type { LocalityRecord } from '../api/localities';
import { LocalityDialogs } from '../localities/LocalityDialogs';
import { useLocalityWorkspace } from '../localities/useLocalityWorkspace';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { dockSlotAtom } from './dockSlot';
import { LocalityDock } from './LocalityDock';
import { RibbonLocalityRow } from './RibbonLocalityRow';

/**
 * Everything the shell grows when a lokalitet is open.
 *
 * This is the one place `useLocalityWorkspace` is mounted. The context strip,
 * the dock and the dialogs all need it, and the hook opens two PocketBase
 * realtime subscriptions that reload the whole list on every event — a second
 * call site would double both.
 *
 * The dock renders through a portal because it belongs to the shell's right
 * slot, on the far side of the tree from the ribbon row that mounts the
 * controller. Reasoning in `dockSlot.ts`.
 *
 * The context strip is outside the boundary that wraps the dock: if the
 * terrain panel throws, you still need the back arrow to get out of it.
 */
export const LocalityRibbon = ({ locality }: { locality: LocalityRecord }) => {
  const ws = useLocalityWorkspace(locality);
  const dockSlot = useAtomValue(dockSlotAtom);

  return (
    <>
      <ErrorBoundary name="RibbonLocalityRow">
        <RibbonLocalityRow ws={ws} />
      </ErrorBoundary>
      {dockSlot &&
        createPortal(
          <ErrorBoundary name="LocalityDock">
            <LocalityDock ws={ws} />
          </ErrorBoundary>,
          dockSlot,
        )}
      <ErrorBoundary name="LocalityDialogs">
        <LocalityDialogs ws={ws} />
      </ErrorBoundary>
    </>
  );
};
