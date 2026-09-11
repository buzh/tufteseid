import { useAtom, useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { LocalityRecord } from '../api/localities';
import { BilderCarousel } from '../localities/BilderCarousel';
import { BilderStrip } from '../localities/BilderStrip';
import { LocalityDialogs } from '../localities/LocalityDialogs';
import { bilderStripOpenAtom } from '../localities/toolAtoms';
import { useLocalityWorkspace } from '../localities/useLocalityWorkspace';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { bottomSlotAtom } from './bottomSlot';
import { dockSlotAtom } from './dockSlot';
import { LocalityDock } from './LocalityDock';
import { RibbonLocalityRow } from './RibbonLocalityRow';

/**
 * Everything the shell grows when a lokalitet is open.
 *
 * This is the one place `useLocalityWorkspace` is mounted. The context strip,
 * the dock, the bottom edge and the dialogs all need it, and the hook opens
 * two PocketBase realtime subscriptions that reload the whole list on every
 * event — a second call site would double both.
 *
 * The dock and the bottom edge render through portals because they belong to
 * the shell's slots, on the far side of the tree from the ribbon row that
 * mounts the controller. Reasoning in `dockSlot.ts` and `bottomSlot.ts`.
 *
 * The context strip is outside the boundary that wraps the dock: if the
 * terrain panel throws, you still need the exits to get out of it.
 */
export const LocalityRibbon = ({ locality }: { locality: LocalityRecord }) => {
  const ws = useLocalityWorkspace(locality);
  const dockSlot = useAtomValue(dockSlotAtom);
  const bottomSlot = useAtomValue(bottomSlotAtom);
  const [stripOpen, setStripOpen] = useAtom(bilderStripOpenAtom);

  // A grunnpakke is minutes long and nobody presses anything to start it any
  // more — it comes with a lokalitet you just made. Unfold the edge, or the
  // first minutes of a new lokalitet are a shell that looks like it did
  // nothing.
  const starterRunning = ws.starterStep != null;
  useEffect(() => {
    if (starterRunning) setStripOpen(true);
  }, [starterRunning, setStripOpen]);

  /*
   * The one-occupant rule (§4.3). Three surfaces want the bottom edge — the
   * filmstrip, the edit carousel and the draw toolbar while a funn draft is
   * open — and none of them may stack, because all of them are over the map.
   * Drawing yields the images: you are not curating a gallery while the pen
   * is down.
   *
   * The draw toolbar is still mobile-only and still `position: fixed` from
   * AppShell (step 12 promotes it into this slot), so today the rule is
   * enforced here rather than by the slot itself — which is also why the
   * check is on `draftActive` rather than on what the slot happens to hold.
   *
   * Which of the first two takes it is the stance, and it is decided here
   * rather than inside one component with branches through it: the rail and
   * the card share their vocabulary (localities/bilderCommon.tsx) but not
   * their geometry, and a component that is a rail on Tuesday is how the
   * write verbs end up merely disabled in show instead of absent (§2).
   */
  const showStrip = stripOpen && ws.hasBilder && !ws.draftActive;

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
      {bottomSlot &&
        showStrip &&
        createPortal(
          <ErrorBoundary name="Bilder">
            {ws.canEdit ? <BilderCarousel ws={ws} /> : <BilderStrip ws={ws} />}
          </ErrorBoundary>,
          bottomSlot,
        )}
      <ErrorBoundary name="LocalityDialogs">
        <LocalityDialogs ws={ws} />
      </ErrorBoundary>
    </>
  );
};
