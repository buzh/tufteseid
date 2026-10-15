import { Group } from '@mantine/core';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { FlyfotoControlGroup, useFlyfotoControls } from '../flyfotoControls';
import { GroundSwitch, useGroundControls } from '../grounds';
import { KartControlGroup, useKartControls } from '../kartControls';
import { LidarControlGroup, useLidarControls } from '../lidarControls';
import {
  type CompareHalf,
  type ViewMode,
  viewModeAtom,
} from '../map/compare/halves';
import styles from './Ribbon.module.css';

const sectionKey = (
  mode: ViewMode,
  half: CompareHalf,
): 'only' | 'under' | 'over' | 'left' | 'right' => {
  if (mode === 'single') return 'only';
  if (mode === 'blend') return half === 'a' ? 'under' : 'over';
  return half === 'a' ? 'left' : 'right';
};

export const GroundSection = ({ half }: { half: CompareHalf }) => {
  const { t } = useTranslation();
  const mode = useAtomValue(viewModeAtom);
  const sectionLabel = t(`ribbon.groundSection.${sectionKey(mode, half)}`);

  const lidar = useLidarControls(half);
  const kart = useKartControls(half);
  const flyfoto = useFlyfotoControls(half);
  const ground = useGroundControls(half, {
    lidar: lidar.enterLidar,
    kart: kart.enterKart,
    flyfoto: flyfoto.enterFlyfoto,
  });

  return (
    <Group
      gap="xs"
      wrap="nowrap"
      className={styles.grounds}
      role="group"
      aria-label={sectionLabel}
    >
      <GroundSwitch ground={ground} />

      {ground.mode === 'lidar' && <LidarControlGroup lidar={lidar} />}
      {ground.mode === 'kart' && <KartControlGroup kart={kart} />}
      {ground.mode === 'flyfoto' && <FlyfotoControlGroup flyfoto={flyfoto} />}
    </Group>
  );
};
