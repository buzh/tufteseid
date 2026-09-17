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
 * A mode rather than a persistent split, because two live tile stacks are twice
 * the GetMap requests and Kartverket rate-limits per source IP across every
 * visitor of this deployment; leaving tears the B stack down.
 */
export const CompareControl = ({ ground }: { ground: GroundHandle }) => {
  const { t } = useTranslation();
  const on = useAtomValue(compareOnAtom);
  const enterCompare = useSetAtom(enterCompareAtom);
  const leaveCompare = useSetAtom(leaveCompareAtom);

  // B starts on the ground you were last on. Terreng cannot be a B half, and
  // neither can the ground already filling the map.
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
