import { useAtomValue } from 'jotai';
import { lazy, Suspense, useEffect, useMemo } from 'react';

import { draftGroundAtom, type DraftGround } from '../evidence/draftGround';
import { EvidenceReader } from '../evidence/EvidenceReader';
import {
  useEvidenceLoopOverlay,
  useEvidenceOverlay,
} from '../evidence/evidenceOverlay';
import { useRectangleAdjust } from '../map/rectAdjust';
import { uiContextAtom } from '../shared/uiContext';
import { useAllSketchesLayer } from '../sketch/allSketches';
import { useSketchOverlay } from '../sketch/overlay';
import { sketchOf } from '../sketch/scene';
import { sketchSessionAtom } from '../sketch/session';
import { useSketchSession } from '../sketch/useSketchSession';
import {
  activeSpotAtom,
  spotAcquiringAtom,
  spotDraftAtom,
  spotFootprintAdjustingAtom,
  spotFootprintAtom,
  spotPlacingAtom,
  spotReadingAtom,
  spotSketchAtom,
} from '../spots/atoms';
import { useSpotPinAdjust } from '../spots/pinAdjust';
import { useSpotPlacement } from '../spots/pinPlace';
import { useSpotShareLink } from '../spots/shareLink';
import { useSpotLayer } from '../spots/spotLayer';
import { useSpotRecords } from '../spots/spotRecords';
import { useSpotScores } from '../spots/spotScores';
import { SpotAcquire } from './SpotAcquire';
import styles from './SpotBox.module.css';
import { SpotCard } from './SpotCard';
import { SpotLinkFailed } from './SpotLinkFailed';
import { SpotPlacePrompt } from './SpotPlacePrompt';
import { SpotProperties } from './SpotProperties';
import { useSpotDraft } from './useSpotDraft';

// Lazy: this surface mounts with the map, and a plain import would put
// Excalidraw's megabytes in the entry chunk. Same in `sketch/render.ts`.
const SketchCanvas = lazy(() =>
  import('../sketch/SketchCanvas').then((mod) => ({
    default: mod.SketchCanvas,
  })),
);

/** Split out so the controller mounts and unmounts with the draft. Only for an
 *  editor draft: a card draft's belongs inside the card, which stays on screen
 *  for the whole of it. */
const SpotPropertiesBox = () => {
  const draft = useAtomValue(spotDraftAtom);
  const active = useAtomValue(activeSpotAtom);
  // The parent renders this only when there is a draft.
  const spot = useSpotDraft(
    draft!,
    active?.id === draft?.recordId ? active : null,
  );
  return <SpotProperties spot={spot} />;
};

/** Its own component because the loop overlay publishes a transport that
 *  changes with every frame, and the surface below renders the whole card. */
const DraftGroundLoop = ({
  ground,
  bandTop,
}: {
  ground: DraftGround;
  bandTop: number;
}) => {
  useEvidenceLoopOverlay(ground.url, ground.extent, 1, bandTop);
  return null;
};

export const SpotSurface = () => {
  const draft = useAtomValue(spotDraftAtom);
  const placing = useAtomValue(spotPlacingAtom);
  const active = useAtomValue(activeSpotAtom);
  const reading = useAtomValue(spotReadingAtom);
  const acquiring = useAtomValue(spotAcquiringAtom);
  const session = useAtomValue(sketchSessionAtom);
  const drawn = useAtomValue(spotSketchAtom);
  const ground = useAtomValue(draftGroundAtom);
  const context = useAtomValue(uiContextAtom);

  // Nothing while a canvas is up (it already shows the scene), the draft's own
  // while one is open, otherwise the open spot's. Keyed on `active.id`/
  // `updated` rather than `active.sketch`, which is a fresh object per read.
  const editing = draft !== null;
  const shown = useMemo(
    () => (session ? null : sketchOf(editing ? drawn : active?.sketch)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, editing, drawn, active?.id, active?.updated],
  );

  // Warm the chunk from the press of the `+`: the draw stage freezes the map
  // before the canvas mounts, so the load must not still be in flight then.
  useEffect(() => {
    if (!editing && !placing) return;
    void import('../sketch/SketchCanvas');
  }, [editing, placing]);

  useSpotRecords();
  useSpotScores();
  useSpotLayer();
  useSpotShareLink();
  useSpotPlacement();
  useSpotPinAdjust();
  useRectangleAdjust({
    rectAtom: spotFootprintAtom,
    activeAtom: spotFootprintAdjustingAtom,
    layerId: 'spotFootprintAdjustLayer',
  });
  useSketchSession(draft?.stage === 'sketch');
  useSketchOverlay(shown);
  useAllSketchesLayer();
  // Rides the map element, so a sketch session's transform carries it along.
  // A loop goes to `DraftGroundLoop` instead: an `ImageStatic` cannot carry a
  // WebM, and the two overlays are never up at once.
  const still = ground?.loop ? null : ground;
  useEvidenceOverlay(still?.url ?? '', still?.extent ?? null, 1);

  return (
    <>
      {ground?.loop && (
        <DraftGroundLoop ground={ground} bandTop={ground.loop.bandTop} />
      )}
      {/* Before the box in document order, so the box paints over it: the
          canvas isolates Excalidraw's z-ladder but still covers the whole
          map rectangle. */}
      {session && (
        <Suspense fallback={null}>
          <SketchCanvas key={session.id} session={session} />
        </Suspense>
      )}
      {/* One banner at a time: both take the same seat. */}
      {placing ? <SpotPlacePrompt /> : <SpotLinkFailed />}
      {/* Away rather than unmounted while a drawing is up: the box carries the
          draft controller, which writes the strokes — on the button the band
          presses, or failing that on its own unmount, which here would fire
          with the canvas still open. */}
      <div className={context === 'draw' ? styles.away : undefined}>
        {/* Keyed on the spot so opening a second does not inherit the first's
            confirm, and so the card survives a card draft opening under it —
            which is what keeps the picture list and the traced ground in
            place while the reader reaches for the rectangle. */}
        {draft?.box === 'editor' ? (
          <SpotPropertiesBox key={draft.id} />
        ) : (
          active &&
          (reading ? (
            <EvidenceReader key={active.id} spot={active} />
          ) : acquiring ? (
            <SpotAcquire key={active.id} spot={active} />
          ) : (
            <SpotCard key={active.id} spot={active} />
          ))
        )}
      </div>
    </>
  );
};
