import { useAtomValue } from 'jotai';
import { lazy, Suspense, useEffect, useMemo } from 'react';

import { useRectangleAdjust } from '../map/rectAdjust';
import { useSketchOverlay } from '../sketch/overlay';
import { sketchOf } from '../sketch/scene';
import { sketchSessionAtom } from '../sketch/session';
import { useSketchSession } from '../sketch/useSketchSession';
import {
  activeSpotAtom,
  spotDraftAtom,
  spotFootprintAdjustingAtom,
  spotFootprintAtom,
  spotPlacingAtom,
  spotSketchAtom,
} from '../spots/atoms';
import { useSpotPinAdjust } from '../spots/pinAdjust';
import { useSpotPlacement } from '../spots/pinPlace';
import { useSpotShareLink } from '../spots/shareLink';
import { useSpotLayer } from '../spots/spotLayer';
import { useSpotRecords } from '../spots/spotRecords';
import { SpotCard } from './SpotCard';
import { SpotPanel } from './SpotPanel';
import { SpotPlacePrompt } from './SpotPlacePrompt';
import { useSpotDraft } from './useSpotDraft';

// Lazy: this surface mounts with the map, and a plain import would put
// Excalidraw's megabytes in the entry chunk. Same in `sketch/render.ts`.
const SketchCanvas = lazy(() =>
  import('../sketch/SketchCanvas').then((mod) => ({
    default: mod.SketchCanvas,
  })),
);

/** Split out so the draft controller mounts and unmounts with the draft. */
const SpotDraftBox = () => {
  const draft = useAtomValue(spotDraftAtom);
  // The parent renders this only when there is a draft.
  const spot = useSpotDraft(draft!);
  return <SpotPanel spot={spot} />;
};

export const SpotSurface = () => {
  const draft = useAtomValue(spotDraftAtom);
  const placing = useAtomValue(spotPlacingAtom);
  const active = useAtomValue(activeSpotAtom);
  const session = useAtomValue(sketchSessionAtom);
  const drawn = useAtomValue(spotSketchAtom);

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

  return (
    <>
      {/* Before the box in document order, so the box paints over it: the
          canvas isolates Excalidraw's z-ladder but still covers the whole
          map rectangle. */}
      {session && (
        <Suspense fallback={null}>
          <SketchCanvas key={session.id} session={session} />
        </Suspense>
      )}
      {placing && <SpotPlacePrompt />}
      {/* One box at a time — they share a corner. Keyed on the spot so opening
          a second does not inherit the first's confirm. */}
      {draft ? (
        <SpotDraftBox key={draft.id} />
      ) : (
        active && <SpotCard key={active.id} spot={active} />
      )}
    </>
  );
};
