import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  type CompareGround,
  enterCompareAtom,
  leaveCompareAtom,
} from '../../map/compare/atoms';
import { compareOnAtom } from '../../map/compare/halves';
import type { GroundHandle } from '../groundHandle';
import { ModeButton } from '../ModeButton';

/**
 * Sammenlign — put a second ground on the right of a draggable curtain.
 *
 * A mode you enter and leave rather than a persistent split: two live tile
 * stacks are roughly twice the GetMap requests, and Kartverket rate-limits
 * per source IP across every visitor of this deployment
 * (docs/wms-proxy-and-tiles.md). Leaving tears the B stack down.
 *
 * Not one of the five ground buttons, because it does not answer "what does
 * the ground look like" — it answers "against what". Hence its own group,
 * and no digit key.
 *
 * One button and nothing else. The B half used to need a pulldown of its own
 * here to name its ground, because it had no other way to say anything; now
 * the whole ribbon retargets to whichever half is focused, so choosing B's
 * ground is the same five buttons that choose A's, and the only new control
 * is the A|B switch on the settings strip.
 *
 * It renders on the *lokalitet* row (docs/lokalitet-view.md §8), so what it
 * knows about the ring arrives as a `GroundHandle` rather than as the whole
 * `GroundControls` — the hook itself is mounted once, a row away.
 */
export const CompareControl = ({ ground }: { ground: GroundHandle }) => {
  const { t } = useTranslation();
  const on = useAtomValue(compareOnAtom);
  const enterCompare = useSetAtom(enterCompareAtom);
  const leaveCompare = useSetAtom(leaveCompareAtom);

  // Entering lands on the ground you were last on, which is almost always
  // the one you just flipped away from to see this one — i.e. the comparison
  // you were already making by hand. Terreng cannot be a B half, and neither
  // can the ground already filling the map, so both fall through to the
  // other of the two that matter.
  const enter = () => {
    const prev = ground.previous();
    const target: CompareGround =
      prev && prev !== 'terreng' && prev !== ground.mode
        ? prev
        : ground.mode === 'flyfoto'
          ? 'lidar'
          : 'flyfoto';
    enterCompare(target);
  };

  return (
    <ModeButton
      icon="compare"
      label={t('ribbon.compare.label')}
      tooltip={t('ribbon.compare.tip')}
      active={on}
      onClick={() => (on ? leaveCompare() : enter())}
    />
  );
};
