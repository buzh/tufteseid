import { useAtom, useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { LocalityRecord } from '../api/localities';
import { BilderCarousel } from '../localities/BilderCarousel';
import { BilderPicker } from '../localities/BilderPicker';
import { BilderStrip } from '../localities/BilderStrip';
import { BildeTransparency } from '../localities/BildeTransparency';
import { FunnCallout } from '../localities/FunnCallout';
import { FunnDrawBar } from '../localities/FunnDrawBar';
import { LocalityDialogs } from '../localities/LocalityDialogs';
import { bilderStripOpenAtom } from '../localities/toolAtoms';
import { useLocalityWorkspace } from '../localities/useLocalityWorkspace';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { bottomSlotAtom } from './bottomSlot';
import { RibbonFunnDraftRow } from './RibbonFunnDraftRow';
import { RibbonLocalityRow } from './RibbonLocalityRow';

/**
 * Everything the shell grows when a lokalitet is open.
 *
 * This is the one place `useLocalityWorkspace` is mounted. The rows, the
 * bottom edge, the map callout and the dialogs all need it, and the hook opens
 * two PocketBase realtime subscriptions that reload the whole list on every
 * event — a second call site would double both.
 *
 * The bottom edge renders through a portal because it belongs to the shell's
 * slot, on the far side of the tree from the ribbon row that mounts the
 * controller. Reasoning in `bottomSlot.ts`.
 *
 * The rows are outside the boundary that wraps the bottom edge: if the
 * carousel throws, you still need the exits to get out of the lokalitet.
 */
export const LocalityRibbon = ({ locality }: { locality: LocalityRecord }) => {
  const ws = useLocalityWorkspace(locality);
  const bottomSlot = useAtomValue(bottomSlotAtom);
  const [stripOpen, setStripOpen] = useAtom(bilderStripOpenAtom);

  // Nobody presses anything to start a grunnpakke any more — it comes with a
  // lokalitet you just made. Unfold the edge, or the first moments of a new
  // lokalitet are a shell that looks like it did nothing. It is a second
  // rather than the old several minutes since the set writes specs (§4.1.2),
  // but the three cards that land are what has to be seen arriving.
  const starterRunning = ws.starterBusy;
  useEffect(() => {
    if (starterRunning) setStripOpen(true);
  }, [starterRunning, setStripOpen]);

  /*
   * The one-occupant rule (§4.3). Four surfaces want the bottom edge — the
   * filmstrip, the edit carousel, a picker run, and the draw toolbar while a
   * funn draft is open — and none of them may stack, because all of them are
   * over the map. Drawing yields the images: you are not curating a gallery
   * while the pen is down.
   *
   * A picker **borrows** the slot rather than being a fifth occupant of it:
   * while a run is live it is what the slot holds, and closing the run gives
   * the collection back. That is why it is a branch here and not a fourth
   * flag — "the kept ones join the collection when you close the picker" is
   * literally true because the collection is not on screen until then.
   *
   * The order of the branches is the priority: the pen outranks a picker,
   * which outranks the collection. It is deepest-first, the same rule the
   * right zone sorts its exits by (§5.3), for the same reason — the thing you
   * are in the middle of is the thing the edge should be serving.
   *
   * Which of the last two takes it is the stance, and it is decided here
   * rather than inside one component with branches through it: the rail and
   * the card share their vocabulary (localities/bilderCommon.tsx) but not
   * their geometry, and a component that is a rail on Tuesday is how the
   * write verbs end up merely disabled in show instead of absent (§2).
   */
  const drawing = ws.draftActive;
  const picking = !drawing && ws.picker.run != null;
  const showStrip = !drawing && !picking && stripOpen && ws.hasBilder;

  return (
    <>
      <ErrorBoundary name="RibbonLocalityRow">
        <RibbonLocalityRow ws={ws} />
      </ErrorBoundary>
      {ws.draftActive && (
        <ErrorBoundary name="RibbonFunnDraftRow">
          <RibbonFunnDraftRow ws={ws} />
        </ErrorBoundary>
      )}
      {bottomSlot &&
        drawing &&
        createPortal(
          <ErrorBoundary name="FunnDrawBar">
            <FunnDrawBar editing={ws.draftIsEdit} />
          </ErrorBoundary>,
          bottomSlot,
        )}
      {bottomSlot &&
        picking &&
        createPortal(
          <ErrorBoundary name="BilderPicker">
            <BilderPicker picker={ws.picker} />
          </ErrorBoundary>,
          bottomSlot,
        )}
      {bottomSlot &&
        showStrip &&
        createPortal(
          <ErrorBoundary name="Bilder">
            {ws.canEdit ? <BilderCarousel ws={ws} /> : <BilderStrip ws={ws} />}
          </ErrorBoundary>,
          bottomSlot,
        )}
      {/* Not in a slot at all: an `ol/Overlay` anchored to the funn itself,
          so it stays on the mound while you pan (§6). */}
      <ErrorBoundary name="FunnCallout">
        <FunnCallout items={ws.findItems} />
      </ErrorBoundary>
      {/* The same idiom, anchored to the rectangle's other top corner: the
          transparency of whatever bilde is on the ground, beside the ground
          rather than down in the strip that used to carry it (§8.9.3). */}
      <ErrorBoundary name="BildeTransparency">
        <BildeTransparency ws={ws} />
      </ErrorBoundary>
      <ErrorBoundary name="LocalityDialogs">
        <LocalityDialogs ws={ws} />
      </ErrorBoundary>
    </>
  );
};
