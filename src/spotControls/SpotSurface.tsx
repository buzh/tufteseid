// The spots' half of the map: the saved pins, the short link, the drawing over
// the ground, and — while a draft is open — the pin in the reader's hand, the
// canvas, and the box beside them. `MapComponent` mounts this and passes it
// nothing.
//
// A component of its own rather than a hook call in the host, for the same
// reason `TerrainSurface` is one: the draft controller is where the name and
// the description live, and a keystroke re-renders whatever holds them. Held
// here, that is the box. Held in `MapComponent`, it would be the panes, the
// curtain and the heritage card alongside it.

import { useAtomValue } from 'jotai';
import { lazy, Suspense, useEffect, useMemo } from 'react';

import { useSketchOverlay } from '../sketch/overlay';
import { sketchOf } from '../sketch/scene';
import { sketchSessionAtom } from '../sketch/session';
import { useSketchSession } from '../sketch/useSketchSession';
import {
  activeSpotAtom,
  spotDraftAtom,
  spotSketchAtom,
} from '../spots/atoms';
import { useSpotPinAdjust } from '../spots/pinAdjust';
import { useSpotShareLink } from '../spots/shareLink';
import { useSpotLayer } from '../spots/spotLayer';
import { useSpotRecords } from '../spots/spotRecords';
import { SpotCard } from './SpotCard';
import { SpotPanel } from './SpotPanel';
import { useSpotDraft } from './useSpotDraft';

// Fetched when a pen is first picked up, not when the map loads. This surface
// is mounted with the map, so a plain import would put Excalidraw — megabytes
// of it, plus its stylesheet — in the entry chunk of every session, including
// the overwhelming majority that never open a draft. `sketch/render.ts` takes
// the same care on its side for the same reason.
const SketchCanvas = lazy(() =>
  import('../sketch/SketchCanvas').then((mod) => ({
    default: mod.SketchCanvas,
  })),
);

/** Split out so the draft controller mounts and unmounts with the draft, which
 *  is what gives each `+` a clean name lookup and a clean save state. */
const SpotDraftBox = () => {
  const draft = useAtomValue(spotDraftAtom);
  // Never rendered without one; the hook needs a non-null draft and React needs
  // the hook count to be constant, so the guard is the parent's.
  const spot = useSpotDraft(draft!);
  return <SpotPanel spot={spot} />;
};

export const SpotSurface = () => {
  const draft = useAtomValue(spotDraftAtom);
  const active = useAtomValue(activeSpotAtom);
  const session = useAtomValue(sketchSessionAtom);
  const drawn = useAtomValue(spotSketchAtom);

  // What is on the ground, checked rather than trusted (`sketchOf`):
  //
  //  * nothing while a canvas is up — the canvas is already showing it, and the
  //    drawing would be on the map twice;
  //  * the draft's own while one is open, saved or not. Putting the pen down
  //    mid-edit used to bring the *stored* drawing back, so a stroke just
  //    erased reappeared under the box that had erased it;
  //  * otherwise the open spot's.
  //
  // Keyed on the record rather than on `active.sketch`, which is re-parsed out
  // of the API's JSON on every read and so is a new object each time: a
  // visibility toggle would otherwise tear the layer down and re-export the
  // scene. `updated` is what says the stored drawing may have changed.
  //
  // On `editing` rather than on the draft itself: that atom is rewritten on
  // every frame of a pin drag, and none of those frames change the drawing.
  const editing = draft !== null;
  const shown = useMemo(
    () => (session ? null : sketchOf(editing ? drawn : active?.sketch)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, editing, drawn, active?.id, active?.updated],
  );

  // Warmed as soon as there is a draft: `Tegn` freezes the map before the
  // canvas mounts, and waiting on the network with the map already stopped is
  // the one moment the split above would be felt.
  useEffect(() => {
    if (!editing) return;
    void import('../sketch/SketchCanvas');
  }, [editing]);

  // The one fetch and the one subscription behind both readers of the list —
  // the pins here and the index in the band. Mounted with the map because that
  // is what the pins are drawn on; the band reads the atom it fills.
  useSpotRecords();
  useSpotLayer();
  useSpotShareLink();
  useSpotPinAdjust();
  useSketchSession(draft?.stage === 'sketch');
  useSketchOverlay(shown);

  return (
    <>
      {/* Before the box in document order, so the box paints over it: the
          canvas isolates Excalidraw's own z-ladder but still occupies the
          whole map rectangle. */}
      {session && (
        // No fallback: the map underneath is what the reader is looking at, and
        // a spinner over it would only cover the ground the pen is for.
        <Suspense fallback={null}>
          <SketchCanvas key={session.id} session={session} />
        </Suspense>
      )}
      {/* One box at a time, and the draft wins: they occupy the same corner,
          and a draft is the thing the reader is doing. Keyed on the spot so
          opening a second one does not inherit the first one's confirm. */}
      {draft ? (
        <SpotDraftBox key={draft.id} />
      ) : (
        active && <SpotCard key={active.id} spot={active} />
      )}
    </>
  );
};
