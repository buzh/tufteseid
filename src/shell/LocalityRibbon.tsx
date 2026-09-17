import { useAtom, useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { LocalityRecord } from '../api/localities';
import { BilderCarousel } from '../localities/BilderCarousel';
import { BilderPicker } from '../localities/BilderPicker';
import { BilderStrip } from '../localities/BilderStrip';
import { FunnCallout } from '../localities/FunnCallout';
import { LocalityDialogs } from '../localities/LocalityDialogs';
import { bilderStripOpenAtom } from '../localities/toolAtoms';
import { useLocalityWorkspace } from '../localities/useLocalityWorkspace';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { bottomSlotAtom } from './bottomSlot';
import { RibbonFunnDraftRow } from './RibbonFunnDraftRow';
import { RibbonLocalityRow } from './RibbonLocalityRow';

/**
 * Everything the shell grows when a lokalitet is open, and the one place
 * `useLocalityWorkspace` is mounted: it opens two PocketBase realtime
 * subscriptions that reload the whole list on every event, so a second call
 * site would double both.
 *
 * The bottom edge portals into the shell's slot, on the far side of the tree.
 * The rows sit outside that boundary: if the carousel throws you still need
 * the exits.
 */
export const LocalityRibbon = ({ locality }: { locality: LocalityRecord }) => {
  const ws = useLocalityWorkspace(locality);
  const bottomSlot = useAtomValue(bottomSlotAtom);
  const [stripOpen, setStripOpen] = useAtom(bilderStripOpenAtom);

  // The starter set is not asked for, it comes with a new lokalitet, so the
  // edge unfolds itself or the three cards land unseen.
  const starterRunning = ws.starterBusy;
  useEffect(() => {
    if (starterRunning) setStripOpen(true);
  }, [starterRunning, setStripOpen]);

  // One occupant of the bottom edge at a time, in branch order, deepest
  // first: the pen outranks a picker, which outranks the collection. Stance
  // picks between the last two here rather than inside one component, so the
  // write verbs stay absent in show rather than merely disabled.
  const drawing = ws.draftActive || ws.sketchActive;
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
      {/* Not in a slot: an `ol/Overlay` anchored to the funn, so it stays on
          the mound while you pan. */}
      <ErrorBoundary name="FunnCallout">
        <FunnCallout items={ws.findItems} />
      </ErrorBoundary>
      <ErrorBoundary name="LocalityDialogs">
        <LocalityDialogs ws={ws} />
      </ErrorBoundary>
    </>
  );
};
