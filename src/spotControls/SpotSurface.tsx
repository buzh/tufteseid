// The spots' half of the map: the saved pins, the short link, and — while a
// draft is open — the pin in the reader's hand and the box beside it.
// `MapComponent` mounts this and passes it nothing.
//
// A component of its own rather than a hook call in the host, for the same
// reason `TerrainSurface` is one: the draft controller is where the name and
// the description live, and a keystroke re-renders whatever holds them. Held
// here, that is the box. Held in `MapComponent`, it would be the panes, the
// curtain and the heritage card alongside it.

import { useAtomValue } from 'jotai';

import { spotDraftAtom } from '../spots/atoms';
import { useSpotPinAdjust } from '../spots/pinAdjust';
import { useSpotShareLink } from '../spots/shareLink';
import { useSpotLayer } from '../spots/spotLayer';
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

  useSpotLayer();
  useSpotShareLink();
  useSpotPinAdjust();

  return draft ? <SpotDraftBox key={draft.id} /> : null;
};
