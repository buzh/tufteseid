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
import { useMemo } from 'react';

import { useSketchOverlay } from '../sketch/overlay';
import { sketchOf } from '../sketch/scene';
import { sketchSessionAtom } from '../sketch/session';
import { SketchCanvas } from '../sketch/SketchCanvas';
import { useSketchSession } from '../sketch/useSketchSession';
import { activeSpotAtom, spotDraftAtom } from '../spots/atoms';
import { useSpotPinAdjust } from '../spots/pinAdjust';
import { useSpotShareLink } from '../spots/shareLink';
import { useSpotLayer } from '../spots/spotLayer';
import { SpotCard } from './SpotCard';
import { SpotPanel } from './SpotPanel';
import { useSpotDraft } from './useSpotDraft';

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

  // The open spot's drawing, checked rather than trusted (`sketchOf`). Null
  // while a canvas is up: a spot being redrawn would otherwise be on the map
  // twice, once as it was saved and once as it is being changed.
  const shown = useMemo(
    () => (session ? null : sketchOf(active?.sketch)),
    [session, active],
  );

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
      {session && <SketchCanvas key={session.id} session={session} />}
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
