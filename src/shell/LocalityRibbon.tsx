import type { LocalityRecord } from '../api/localities';
import { LocalityDialogs } from '../localities/LocalityDialogs';
import { useLocalityWorkspace } from '../localities/useLocalityWorkspace';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { RibbonLocalityRow } from './RibbonLocalityRow';
import { RibbonToolRow } from './RibbonToolRow';
import { Tray } from './Tray';

/**
 * Everything the ribbon grows when a lokalitet is open.
 *
 * This is the one place `useLocalityWorkspace` is mounted. Row 2, the tool
 * row, the tray columns and the dialogs all need it, and the hook opens two
 * PocketBase realtime subscriptions that reload the whole list on every
 * event — a second call site would double both.
 *
 * Row 2 is outside the boundary that wraps the surface below it: if the
 * terrain panel throws, you still need the back arrow to get out of it.
 */
export const LocalityRibbon = ({ locality }: { locality: LocalityRecord }) => {
  const ws = useLocalityWorkspace(locality);

  return (
    <>
      <ErrorBoundary name="RibbonLocalityRow">
        <RibbonLocalityRow ws={ws} />
      </ErrorBoundary>
      {/* `terrain` is missing on purpose: that surface exists with no
          lokalitet too, so the ribbon renders it a level up. Everything here
          still stands down for it — the tray is not shown, because the mode
          is not `browse`. */}
      <ErrorBoundary name="RibbonWorkspaceBody">
        {ws.mode === 'browse' && <Tray ws={ws} />}
        {(ws.mode === 'draft' || ws.mode === 'lidar') && (
          <RibbonToolRow ws={ws} />
        )}
      </ErrorBoundary>
      <ErrorBoundary name="LocalityDialogs">
        <LocalityDialogs ws={ws} />
      </ErrorBoundary>
    </>
  );
};
